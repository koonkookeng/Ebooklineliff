// SSOT Phase 029 Task 5/§5.2 — Predictive prefetch service (edge warm + telemetry)
// Canonical: apps/backend/src/modules/performance/application/services/predictive-prefetch.service.ts
// (legacy src/backend/modules/performance/.../predictive-prefetch.service.ts)
// - Zod-validated input → per-resource edge check (hit = key exists) → miss warms
//   the key with an R2 pointer payload (EBOOK_PAGE resolves storagePathR2 +
//   totalPages from Prisma; other types cache a signed-pointer stub the client
//   resolves via existing chunk APIs — no new endpoints, Gate 6).
// - TTL 900s (§8.1); analytics append + telemetry publish are best-effort.
// - Zero new deps: Prisma SSOT + RedisPrefetchCacheAdapter only.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { RedisPrefetchCacheAdapter } from '../../infrastructure/adapters/redis-prefetch-cache.adapter';
import { PrismaPerformanceRepository } from '../../infrastructure/persistence/prisma-performance.repository';
import {
  PrefetchRequestSchema,
  PERF_TELEMETRY_CHANNEL,
  PREFETCH_TTL_SEC,
  prefetchCacheKey,
  type PrefetchRequest,
} from '@repo/shared';

interface EbookPointer {
  kind: 'EBOOK_PAGE';
  storagePathR2: string;
  totalPages: number;
  pageNumber: number;
  prefetchedAt: string;
}

interface GenericPointer {
  kind: string;
  productId: string;
  resourceId: string;
  prefetchedAt: string;
}

@Injectable()
export class PredictivePrefetchService {
  private readonly logger = new Logger(PredictivePrefetchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edge: RedisPrefetchCacheAdapter,
    private readonly repo: PrismaPerformanceRepository,
  ) {}

  async processPredictivePrefetch(body: unknown): Promise<{
    success: boolean;
    prefetchedCount: number;
    cacheStorageKeys: string[];
  }> {
    const parsed = PrefetchRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid prefetch request');
    const input: PrefetchRequest = parsed.data;
    const cacheKeys: string[] = [];
    let hits = 0;

    for (const resourceId of input.predictedNextResourceIds) {
      const key = prefetchCacheKey(input.productId, input.currentResourceType, resourceId);
      if (await this.edge.exists(key)) {
        hits++;
        cacheKeys.push(key);
        continue;
      }
      const payload = await this.buildPointer(input.productId, input.currentResourceType, resourceId);
      if (payload) {
        await this.edge.setex(key, PREFETCH_TTL_SEC, JSON.stringify(payload));
        cacheKeys.push(key);
      }
    }

    const head = input.predictedNextResourceIds[0];
    void this.repo
      .logPrefetch({
        userId: input.userId,
        productId: input.productId,
        resourceKey: `${input.currentResourceType}:${head}`,
        isHit: hits > 0,
        latencySavedMs: hits > 0 ? 180 : 0,
      })
      .catch(() => undefined);
    void this.edge
      .publish(
        PERF_TELEMETRY_CHANNEL,
        JSON.stringify({ event: 'prefetch.triggered', userId: input.userId, productId: input.productId, hits, total: cacheKeys.length }),
      )
      .catch((err: unknown) => {
        this.logger.warn(`Prefetch telemetry failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });

    return { success: true, prefetchedCount: cacheKeys.length, cacheStorageKeys: cacheKeys };
  }

  private async buildPointer(
    productId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<EbookPointer | GenericPointer | null> {
    const now = new Date().toISOString();
    if (resourceType === 'EBOOK_PAGE') {
      const pageNumber = Number.parseInt(resourceId, 10);
      if (!Number.isInteger(pageNumber) || pageNumber <= 0) return null;
      const detail = await (this.prisma as unknown as {
        ebookDetail: {
          findFirst: (args: unknown) => Promise<{ storagePathR2: string; totalPages: number } | null>;
        };
      }).ebookDetail
        .findFirst({ where: { productId }, select: { storagePathR2: true, totalPages: true } })
        .catch(() => null);
      if (!detail || pageNumber > detail.totalPages) return null;
      return { kind: 'EBOOK_PAGE', storagePathR2: detail.storagePathR2, totalPages: detail.totalPages, pageNumber, prefetchedAt: now };
    }
    return { kind: resourceType, productId, resourceId, prefetchedAt: now };
  }
}
