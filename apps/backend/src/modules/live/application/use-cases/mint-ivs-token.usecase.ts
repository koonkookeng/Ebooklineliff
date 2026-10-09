// SSOT Phase 099 BDD-1 — Stream access use-case (gate + HMAC playback mint)
// Canonical: apps/backend/src/modules/live/application/use-cases/mint-ivs-token.usecase.ts
// - Session must be joinable (LIVE/PAUSED) → entitlement gate (≤50ms shape)
//   → vendor playback + 5-min token → forensic watermark → grant ledger +
//   stream event. Port-based, DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_PLAYBACK_TOKEN_TTL_SEC, LIVE_STREAM, liveGrantKey, liveUserHash } from '@repo/shared';
import { isJoinable, type LiveStatus } from '../../domain/entities/live-session.entity';
import { EntitlementCheckerService } from '../../domain/services/entitlement-checker.service';
import { AmazonIvsAdapter } from '../../infrastructure/adapters/amazon-ivs.adapter';
import type { LiveRepository } from '../../infrastructure/persistence/live-session.repository';

export interface LiveBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
  setGrant(key: string, token: string, ttlSec: number): Promise<void>;
}

@Injectable()
export class MintPlaybackTokenUseCase {
  constructor(
    private readonly repo: LiveRepository,
    private readonly gate: EntitlementCheckerService,
    private readonly vendor: AmazonIvsAdapter,
    private readonly bus: LiveBus,
    private readonly watermarkSalt = process.env['LIVE_WATERMARK_SALT'] || 'dev-live-salt',
  ) {}

  async join(args: { sessionId: string; userId: string }): Promise<{
    sessionId: string;
    vendor: string;
    playbackUrl: string;
    playbackToken: string;
    watermarkData: { text: string; userIdHash: string; timestamp: string };
    expiresAt: string;
  }> {
    const t0 = Date.now();
    const session = await this.repo.findSessionById(args.sessionId);
    if (!session) throw new Error('Live session not found');
    if (!isJoinable(session.status as LiveStatus)) throw new Error(`Session is ${session.status}`);
    await this.gate.requireAccess({ userId: args.userId, productId: session.productId });
    if (Date.now() - t0 > 50) {
      // Budget probe (Gate 7): still serve, but flag the overrun.
      await this.bus.xadd(LIVE_STREAM, { event: 'live.gate.overrun', sessionId: args.sessionId, at: Date.now() }).catch(() => undefined);
    }

    const minted = this.vendor.mint({
      sessionId: session.id,
      userId: args.userId,
      vendor: session.vendor,
      playbackArn: session.playbackArn,
    });
    const userIdHash = liveUserHash(args.userId, this.watermarkSalt);
    const now = new Date().toISOString();
    await this.bus.setGrant(liveGrantKey(session.id, args.userId), minted.playbackToken, LIVE_PLAYBACK_TOKEN_TTL_SEC).catch(() => undefined);
    await this.bus
      .xadd(LIVE_STREAM, { event: 'live.joined', sessionId: session.id, vendor: session.vendor, at: Date.now() })
      .catch(() => undefined);
    return {
      sessionId: session.id,
      vendor: minted.vendor,
      playbackUrl: minted.playbackUrl,
      playbackToken: minted.playbackToken,
      watermarkData: { text: `LICENSED-USER: ${userIdHash}`, userIdHash, timestamp: now },
      expiresAt: minted.expiresAt,
    };
  }
}
