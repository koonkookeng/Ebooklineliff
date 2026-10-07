// SSOT Phase 026 §5.2 — Social share service (flex payload + atomic share logging)
// Canonical: apps/backend/src/modules/social-share/services/social-share.service.ts
// (legacy src/backend/modules/social-share/services/social-share.service.ts)
// - Zero new deps (node:crypto for unguessable share tokens).
// - Gate 7: recordShareLog runs in a Prisma atomic txn (ShareLog row + +5 reward
//   points). CANCELLED/FAILED log without points and never throw for the caller.
// - Gate 8: SUCCESS emits a `stream:share:viral` Redis event (K-factor pipeline).
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { FlexMessageBuilderService } from './flex-message-builder.service';
import {
  DynamicFlexShareInputSchema,
  RecordShareLogInputSchema,
  SHARE_REWARD_POINTS,
  type GenerateFlexShareResponse,
  type ShareTargetPickerResult,
} from '@repo/shared';

const SHARE_STREAM = 'stream:share:viral';

function newShareToken(): string {
  return `SR-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class SocialShareService {
  private readonly logger = new Logger(SocialShareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flexBuilder: FlexMessageBuilderService,
    private readonly redis: RedisClusterService,
  ) {}

  async generateFlexSharePayload(
    userId: string,
    rawInput: unknown,
  ): Promise<GenerateFlexShareResponse> {
    const parsed = DynamicFlexShareInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid share input');
    const input = parsed.data;

    const [user, product] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, displayName: true, affiliateCode: true },
      }),
      this.prisma.product.findUnique({
        where: { id: input.productId },
        include: { ebookDetail: true, courseDetail: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!product) throw new NotFoundException('Product not found');

    const shareToken = newShareToken();
    const base = process.env.LIFF_BASE_URL ?? 'https://liff.ebook.example.com';
    const deepLinkUrl =
      `${base}/share/preview?tenant=default` +
      `&target=${input.contentType.toLowerCase()}&id=${product.id}` +
      `&ref=${encodeURIComponent(user.affiliateCode)}&st=${shareToken}`;

    const flex = this.flexBuilder.buildProductFlexBubble({
      productTitle: product.title,
      coverImageUrl: product.coverImageUrl,
      price: Number(product.price),
      ...(product.discountPrice !== null && product.discountPrice !== undefined
        ? { discountPrice: Number(product.discountPrice) }
        : {}),
      referrerName: user.displayName,
      ...(input.customQuote ? { customQuote: input.customQuote } : {}),
      deepLinkUrl,
      contentType: input.contentType,
      ...(input.targetPageNumber !== undefined ? { pageNumber: input.targetPageNumber } : {}),
    });

    return {
      flexMessageJson: JSON.stringify(flex),
      shareToken,
      affiliateCode: user.affiliateCode,
      deepLinkUrl,
    };
  }

  async recordShareLog(userId: string, rawInput: unknown): Promise<ShareTargetPickerResult> {
    const parsed = RecordShareLogInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestException('Invalid share-log input');
    const input = parsed.data;

    const reward = input.status === 'SUCCESS' ? SHARE_REWARD_POINTS : 0;
    const log = await this.prisma.$transaction(async (tx) => {
      if (reward > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { rewardPoints: { increment: reward } },
        });
      }
      return tx.shareLog.create({
        data: {
          userId,
          productId: input.productId,
          shareToken: input.shareToken,
          targetType: input.targetType,
          status: input.status,
          rewardPointsAwarded: reward,
        },
      });
    }).catch((err: unknown) => {
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Share token already recorded.');
      }
      throw err;
    });

    if (input.status === 'SUCCESS') {
      void this.redis
        .publish(
          SHARE_STREAM,
          JSON.stringify({
            event: 'share.logged',
            shareLogId: log.id,
            userId,
            productId: input.productId,
            targetType: input.targetType,
            at: new Date().toISOString(),
          }),
        )
        .catch(() => undefined);
    }

    return {
      success: true,
      shareLogId: log.id,
      rewardPointsEarned: reward,
      message:
        input.status === 'SUCCESS' ? 'Share logged and points awarded' : 'Share status logged',
    };
  }

  /** Viral click-through: bump counters + K-factor event (best-effort, never 500s). */
  async trackShareClick(shareToken: string): Promise<{
    shareLogId: string;
    productId: string;
    productTitle: string;
    productType: string;
    coverImageUrl: string;
  } | null> {
    try {
      const log = await this.prisma.shareLog.findUnique({
        where: { shareToken },
        include: {
          product: { select: { id: true, title: true, productType: true, coverImageUrl: true } },
        },
      });
      if (!log) return null;
      await this.prisma.shareLog
        .update({ where: { id: log.id }, data: { clickCount: { increment: 1 } } })
        .catch(() => undefined);
      void this.redis
        .publish(
          SHARE_STREAM,
          JSON.stringify({ event: 'share.clicked', shareLogId: log.id, at: new Date().toISOString() }),
        )
        .catch(() => undefined);
      return {
        shareLogId: log.id,
        productId: log.product.id,
        productTitle: log.product.title,
        productType: log.product.productType,
        coverImageUrl: log.product.coverImageUrl,
      };
    } catch (err) {
      this.logger.warn(`trackShareClick failed for token ${shareToken}: ${(err as Error).message}`);
      return null;
    }
  }
}
