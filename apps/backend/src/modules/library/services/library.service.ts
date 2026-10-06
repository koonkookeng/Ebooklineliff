// SSOT Phase 018 §5.2 — Library core service (edge-cached assets + gatekeeper)
// Canonical: apps/backend/src/modules/library/services/library.service.ts
// (legacy src/backend/modules/library/services/library.service.ts)
// Budget: cache hit <200ms; miss = 4 batched reads max (entitlements + count +
// ebook progress + course progress) — never per-row queries (no N+1).
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  DigitalAssetSchema,
  MyLibraryPayloadSchema,
  MyLibraryQueryInputSchema,
  type DigitalAsset,
  type MyLibraryPayload,
  type MyLibraryQueryInput,
} from '@repo/shared';
import { AssetFormatterService, type CourseProgressRow, type EbookProgressRow, type EntitlementRow } from './asset-formatter.service';
import { LibraryCacheRepository } from '../repositories/library-cache.repository';

const LIBRARY_TYPES = ['EBOOK', 'ELEARNING_COURSE', 'HYBRID_BUNDLE', 'LIVE_CLASS'] as const;

type DbLike = {
  entitlement: {
    findMany: (args: unknown) => Promise<EntitlementRow[]>;
    count: (args: unknown) => Promise<number>;
    findUnique: (args: unknown) => Promise<{ expiresAt: Date | null; accessType: string } | null>;
  };
  ebookReadingProgress: {
    findMany: (args: unknown) => Promise<EbookProgressRow[]>;
  };
  courseLearningProgress: {
    findMany: (args: unknown) => Promise<CourseProgressRow[]>;
  };
};

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly formatter: AssetFormatterService,
    private readonly cache: LibraryCacheRepository,
  ) {}

  /** BDD scenario 1: filtered library fetch (Redis <200ms on hit, indexed DB on miss). */
  async getUserLibraryAssets(userId: string, rawInput: unknown): Promise<MyLibraryPayload> {
    if (!userId) throw new BadRequestException('Missing user id');
    const parsed = MyLibraryQueryInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid library query');
    const input: MyLibraryQueryInput = {
      assetType: parsed.data.assetType,
      searchQuery: parsed.data.searchQuery?.trim() || undefined,
      sortBy: parsed.data.sortBy,
      page: parsed.data.page,
      limit: parsed.data.limit,
    };
    const cached = await this.cache.getPayload(userId, input);
    if (cached) return cached;

    const db = this.prisma as unknown as DbLike;
    const now = new Date();
    const productFilter: Record<string, unknown> = {
      productType: input.assetType ? input.assetType : { in: [...LIBRARY_TYPES] },
    };
    if (input.searchQuery) productFilter['title'] = { contains: input.searchQuery, mode: 'insensitive' };
    const where = {
      userId,
      product: productFilter,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const orderBy =
      input.sortBy === 'TITLE_ASC'
        ? { product: { title: 'asc' } }
        : input.sortBy === 'PURCHASE_DATE_DESC'
          ? { createdAt: 'desc' as const }
          : { updatedAt: 'desc' as const };

    const [rows, totalCount] = await Promise.all([
      db.entitlement
        .findMany({
          where,
          include: {
            product: {
              select: {
                title: true,
                coverImageUrl: true,
                productType: true,
                ebookDetail: { select: { totalPages: true } },
                courseDetail: { select: { sections: { select: { lessons: { select: { id: true } } } } } },
              },
            },
          },
          orderBy,
          take: input.limit,
          skip: (input.page - 1) * input.limit,
        })
        .catch(() => [] as EntitlementRow[]),
      db.entitlement.count({ where }).catch(() => 0),
    ]);

    // Batched progress reads (2 queries regardless of page size).
    const ebookIds = rows.filter((r) => r.product.productType === 'EBOOK').map((r) => r.productId);
    const lessonIds = rows
      .filter((r) => r.product.productType === 'ELEARNING_COURSE')
      .flatMap((r) => (r.product.courseDetail?.sections ?? []).flatMap((s) => s.lessons.map((l) => l.id)));
    const [ebookRows, courseRows] = await Promise.all([
      ebookIds.length > 0
        ? db.ebookReadingProgress.findMany({ where: { userId, ebookId: { in: ebookIds } } }).catch(() => [] as EbookProgressRow[])
        : Promise.resolve([] as EbookProgressRow[]),
      lessonIds.length > 0
        ? db.courseLearningProgress.findMany({ where: { userId, lessonId: { in: lessonIds } } }).catch(() => [] as CourseProgressRow[])
        : Promise.resolve([] as CourseProgressRow[]),
    ]);
    const ebookByProduct = new Map(ebookRows.map((p) => [p.ebookId, p]));
    const courseByLesson = new Map(courseRows.map((p) => [p.lessonId, p]));

    let assets: DigitalAsset[] = [];
    for (const ent of rows) {
      const formatted = this.formatter.format(ent, ebookByProduct, courseByLesson);
      if (!formatted) continue;
      const checked = DigitalAssetSchema.safeParse(formatted);
      if (checked.success) assets.push(checked.data);
    }
    // PROGRESS_ASC is computed post-read: order the fetched page (documented).
    if (input.sortBy === 'PROGRESS_ASC') assets = [...assets].sort((a, b) => a.progressPercentage - b.progressPercentage);

    const totalPages = Math.max(1, Math.ceil(totalCount / input.limit));
    const payload: MyLibraryPayload = {
      assets,
      totalCount,
      currentPage: input.page,
      totalPages,
      hasMore: input.page * input.limit < totalCount,
    };
    const validated = MyLibraryPayloadSchema.safeParse(payload);
    if (!validated.success) throw new BadRequestException('Library payload contract drift');
    await this.cache.setPayload(userId, input, validated.data);
    return validated.data;
  }

  /**
   * BDD scenario 2: real-time entitlement gatekeeper (Redis flag → DB fallback).
   * Emits LIBRARY_ASSET_OPENED telemetry on every granted check (best-effort).
   */
  async checkAccess(userId: string, productId: string): Promise<{ hasAccess: boolean }> {
    if (!userId || !productId) throw new BadRequestException('Missing gate parameters');
    if (await this.cache.checkGate(userId, productId)) {
      await this.trackOpen(userId, productId, 'CACHED_GRANT');
      return { hasAccess: true };
    }
    const db = this.prisma as unknown as DbLike;
    const row = await db.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    const valid = row !== null && (row.expiresAt === null || row.expiresAt > new Date());
    if (!valid) return { hasAccess: false };
    await this.cache.setGate(userId, productId);
    await this.trackOpen(userId, productId, row.accessType);
    return { hasAccess: true };
  }

  private async trackOpen(userId: string, productId: string, accessType: string): Promise<void> {
    await this.redis
      .publish('stream:analytics:library', JSON.stringify({ event: 'LIBRARY_ASSET_OPENED', userId, productId, accessType, at: new Date().toISOString() }))
      .catch(() => undefined);
  }
}
