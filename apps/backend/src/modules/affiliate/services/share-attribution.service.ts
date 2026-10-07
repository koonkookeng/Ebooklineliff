// SSOT Phase 026 Task 6 — Viral share attribution (click → bind → commission)
// Canonical: apps/backend/src/modules/affiliate/services/share-attribution.service.ts
// (legacy src/backend/modules/affiliate/services/share-attribution.service.ts)
// - Zero new deps. Idempotent by construction: orderId @unique (P2002 → return
//   existing), referral bind is find-or-create per (shareLog, referredUser).
// - Commission credit is a pure attribution write (orderId link + amount); the
//   payout engine (Phase 079) settles separately — this module never touches money.
// - Redis K-factor events best-effort (Gate 8), never fail the caller.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { REFERRAL_BIND_DAYS } from '@repo/shared';

const SHARE_STREAM = 'stream:share:viral';

@Injectable()
export class ShareAttributionService {
  private readonly logger = new Logger(ShareAttributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  /** Bind a referred user to a share token (30-day window from share creation). */
  async bindReferral(shareToken: string, referredUserId: string) {
    const log = await this.prisma.shareLog.findUnique({ where: { shareToken } });
    if (!log) return null;
    const ageMs = Date.now() - new Date(log.createdAt).getTime();
    if (ageMs > REFERRAL_BIND_DAYS * 24 * 60 * 60 * 1000) return null;

    const existing = await this.prisma.viralAttribution.findFirst({
      where: { shareLogId: log.id, referredUserId },
    });
    if (existing) return existing;

    const created = await this.prisma.viralAttribution.create({
      data: { shareLogId: log.id, referredUserId },
    });
    void this.redis
      .publish(
        SHARE_STREAM,
        JSON.stringify({ event: 'share.referral-bound', shareLogId: log.id, referredUserId, at: new Date().toISOString() }),
      )
      .catch(() => undefined);
    return created;
  }

  /** Credit commission to a referral when their order completes (idempotent). */
  async creditOrderCommission(orderId: string, referredUserId: string, commissionAmt: number) {
    try {
      const attribution = await this.prisma.viralAttribution.findFirst({
        where: { referredUserId, orderId: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!attribution) return null;
      const credited = await this.prisma.viralAttribution.update({
        where: { id: attribution.id },
        data: { orderId, commissionAmt },
      });
      await this.prisma.shareLog
        .update({ where: { id: attribution.shareLogId }, data: { conversionCount: { increment: 1 } } })
        .catch(() => undefined);
      void this.redis
        .publish(
          SHARE_STREAM,
          JSON.stringify({ event: 'share.converted', shareLogId: attribution.shareLogId, orderId, at: new Date().toISOString() }),
        )
        .catch(() => undefined);
      return credited;
    } catch (err) {
      // P2002 (orderId already credited) → idempotent return, never double-count.
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
        return this.prisma.viralAttribution.findUnique({ where: { orderId } }).catch(() => null);
      }
      this.logger.warn(`creditOrderCommission failed for order ${orderId}: ${(err as Error).message}`);
      return null;
    }
  }
}
