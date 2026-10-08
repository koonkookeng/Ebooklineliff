// SSOT Phase 080 Task 4/6 — Track click use-case (signed attribution intake)
// Canonical: apps/backend/src/modules/share/application/track-click.usecase.ts
// - Flow (BDD-2): verify HMAC (invalid/expired → success:false, never throws)
//   -> resolve ShareEvent (unknown token → success:false) -> anti-self-click
//   (visitor LINE ID == sharer LINE ID → success:false + fraud stream, order
//   still processable) -> Redis 30-day session (first-seen = isNewSession)
//   -> atomic AffiliateClick + clickCount++ (Gate 7) -> click stream (Gate 8).
// - Conversion marking (isConverted/orderId) stays with the order/079 payout
//   path — this intake only records the click (zero money writes).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { FLEX_CLICK_STREAM, FLEX_FRAUD_STREAM } from '@repo/shared';
import type { ShareRepository } from '../domain/share.repository';
import type { ShareCachePort } from '../infrastructure/share-redis.cache';
import { AttributionSigner } from '../domain/attribution.signer';

export interface TrackClickTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class TrackClickUseCase {
  constructor(
    private readonly repo: ShareRepository,
    private readonly cache: ShareCachePort,
    private readonly signer: AttributionSigner,
    private readonly tx: TrackClickTx,
  ) {}

  async execute(args: {
    refToken: string;
    visitorLineId: string | null;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ success: boolean; affiliateCode: string; isNewSession: boolean; productId: string | null }> {
    const claims = this.signer.verify(args.refToken);
    if (!claims) return { success: false, affiliateCode: '', isNewSession: false, productId: null };

    const event = await this.repo.findShareEventByRefToken(args.refToken);
    if (!event) return { success: false, affiliateCode: claims.affiliateCode, isNewSession: false, productId: claims.productId };

    // Anti-self-referral: sharer clicking their own card earns nothing (BDD).
    if (args.visitorLineId) {
      const sharer = await this.repo.findUser(event.userId);
      if (sharer?.lineUserId && sharer.lineUserId === args.visitorLineId) {
        await this.cache.emit(FLEX_FRAUD_STREAM, {
          event: 'share.click.self-blocked',
          shareEventId: event.id,
          at: Date.now(),
        });
        return { success: false, affiliateCode: claims.affiliateCode, isNewSession: false, productId: event.productId };
      }
    }

    const visitorKey = args.visitorLineId ?? `${args.ipAddress}:${args.userAgent.slice(0, 32)}`;
    const seen = await this.cache.sessionSeen(args.refToken, visitorKey);
    const isNewSession = !seen;
    await this.cache.rememberSession(args.refToken, visitorKey);

    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      await repo.recordClick({
        shareEventId: event.id,
        visitorLineId: args.visitorLineId,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent.slice(0, 255),
      });
    });

    await this.cache.emit(FLEX_CLICK_STREAM, {
      event: 'share.flex.clicked',
      shareEventId: event.id,
      productId: event.productId,
      isNewSession: isNewSession ? 1 : 0,
      at: Date.now(),
    });
    return { success: true, affiliateCode: claims.affiliateCode, isNewSession, productId: event.productId };
  }
}
