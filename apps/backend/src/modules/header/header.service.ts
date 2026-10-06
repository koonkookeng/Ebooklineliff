// SSOT Phase 023 §5.2 — Header context service with Redis edge cache (<5ms hit path)
// Canonical: apps/backend/src/modules/header/header.service.ts
// (legacy src/backend/modules/header/header.service.ts)
// - Zero new deps: Prisma SSOT + RedisClusterService (get/setex) only.
// - Cache-first: edge hit returns without DB; miss computes, caches 1h, returns.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  DynamicHeaderInputSchema,
  DynamicHeaderPayloadSchema,
  type DynamicHeaderInput,
  type DynamicHeaderPayload,
  type HeaderDisplayMode,
} from '@repo/shared';

const CACHE_TTL_SEC = 3600; // 1-hour edge cache (§5.2)

function displayModeFor(productType: string): HeaderDisplayMode {
  if (productType === 'EBOOK') return 'EBOOK_READER';
  if (productType === 'ELEARNING_COURSE') return 'ELEARNING_LESSON';
  if (productType === 'LIVE_CLASS') return 'LIVE_STREAM';
  return 'DEFAULT_STORE';
}

@Injectable()
export class HeaderService {
  private readonly logger = new Logger(HeaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  cacheKey(productId: string, chapterOrLessonId?: string): string {
    return `header:ctx:${productId}:${chapterOrLessonId || 'default'}`;
  }

  async getHeaderContext(productId: string, chapterOrLessonId?: string): Promise<DynamicHeaderPayload> {
    const parsed = DynamicHeaderInputSchema.safeParse({ productId, chapterOrLessonId });
    if (!parsed.success) throw new NotFoundException('Invalid header context input');
    const input: DynamicHeaderInput = parsed.data;

    const key = this.cacheKey(input.productId, input.chapterOrLessonId);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      const hit = DynamicHeaderPayloadSchema.safeParse(JSON.parse(cached) as unknown);
      if (hit.success) return hit.data;
      // Corrupt entry: fall through and rebuild (self-healing, no throw on edge data).
      this.logger.warn(`Corrupt header cache entry rebuilt: ${key}`);
    }

    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      include: {
        headerConfig: true,
        ebookDetail: { include: { chapters: true } },
        courseDetail: { include: { sections: { include: { lessons: true } } } },
      },
    });
    if (!product) throw new NotFoundException(`Product not found for Header Context: ${input.productId}`);

    let mainTitle = product.headerConfig?.customHeaderTitle ?? product.title;
    let subtitle = '';
    if (product.productType === 'EBOOK' && input.chapterOrLessonId) {
      const chapter = product.ebookDetail?.chapters.find((c) => c.id === input.chapterOrLessonId);
      if (chapter) subtitle = `บทที่ ${chapter.chapterIndex}: ${chapter.title}`;
    } else if (product.productType === 'ELEARNING_COURSE' && input.chapterOrLessonId) {
      for (const sec of product.courseDetail?.sections ?? []) {
        const lesson = sec.lessons.find((l) => l.id === input.chapterOrLessonId);
        if (lesson) {
          subtitle = `${sec.title} - ${lesson.title}`;
          break;
        }
      }
    }

    const payload: DynamicHeaderPayload = {
      tenantId: product.tenantId ?? product.sellerId,
      displayMode: displayModeFor(product.productType),
      mainTitle,
      subtitle: subtitle || undefined,
      brandColor: product.headerConfig?.overrideBrandColor ?? '#0284C7',
      showBackButton: true,
      actionIcons: [
        { id: 'share', iconName: 'Share2', actionIntent: 'TRIGGER_LINE_FLEX_SHARE' },
        { id: 'bookmark', iconName: 'Bookmark', actionIntent: 'TOGGLE_BOOKMARK' },
      ],
    };

    await this.redis.setex(key, CACHE_TTL_SEC, JSON.stringify(payload)).catch((err: unknown) => {
      this.logger.warn(`Header cache write failed: ${err instanceof Error ? err.message : 'unknown'}`);
    });
    return payload;
  }

  /** Mutation path: persist overrides, invalidate edge entry, return fresh context. */
  async updateHeaderContext(input: DynamicHeaderInput & { brandColor?: string }): Promise<DynamicHeaderPayload> {
    const parsed = DynamicHeaderInputSchema.safeParse(input);
    if (!parsed.success) throw new NotFoundException('Invalid header context input');
    const data = parsed.data;

    await this.prisma.headerConfig
      .upsert({
        where: { productId: data.productId },
        update: {
          ...(data.customTitle ? { customHeaderTitle: data.customTitle } : {}),
          ...(input.brandColor ? { overrideBrandColor: input.brandColor } : {}),
        },
        create: {
          productId: data.productId,
          customHeaderTitle: data.customTitle ?? null,
          overrideBrandColor: input.brandColor ?? null,
        },
      })
      .catch((err: unknown) => {
        throw new NotFoundException(err instanceof Error ? err.message : 'Header config update failed');
      });

    await this.redis.del(this.cacheKey(data.productId, data.chapterOrLessonId)).catch(() => undefined);
    return this.getHeaderContext(data.productId, data.chapterOrLessonId);
  }
}
