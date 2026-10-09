// SSOT Phase 099 Task 2 — WebRTC signaling use-case (offer gate + answer)
// Canonical: apps/backend/src/modules/live/application/use-cases/handle-webrtc-signaling.usecase.ts
// - WEBRTC_NATIVE sessions only → SDP offer shape gate → entitlement re-gate
//   → synthetic answer ledger (no SFU in scope; edge negotiates media) +
//   grant + stream event. Port-based, DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_STREAM, liveGrantKey } from '@repo/shared';
import { EntitlementCheckerService } from '../../domain/services/entitlement-checker.service';
import type { LiveRepository } from '../../infrastructure/persistence/live-session.repository';
import type { LiveBus } from './mint-ivs-token.usecase';

@Injectable()
export class HandleWebrtcSignalingUseCase {
  constructor(
    private readonly repo: LiveRepository,
    private readonly gate: EntitlementCheckerService,
    private readonly bus: LiveBus,
  ) {}

  async answer(args: { sessionId: string; userId: string; sdpOffer: string }): Promise<{
    sessionId: string;
    webrtcSdpAnswer: string;
    expiresAt: string;
  }> {
    if (!args.sdpOffer.includes('v=0')) throw new Error('Invalid SDP offer');
    const session = await this.repo.findSessionById(args.sessionId);
    if (!session) throw new Error('Live session not found');
    if (session.vendor !== 'WEBRTC_NATIVE') throw new Error('Session is not WebRTC native');
    if (session.status !== 'LIVE') throw new Error(`Session is ${session.status}`);
    await this.gate.requireAccess({ userId: args.userId, productId: session.productId });

    // Ledger marker (edge SFU owns real negotiation; the answer echoes the
    // offer fingerprint so clients can correlate).
    let fingerprint = 0;
    for (let i = 0; i < args.sdpOffer.length; i++) fingerprint = (fingerprint * 31 + args.sdpOffer.charCodeAt(i)) >>> 0;
    const webrtcSdpAnswer = `v=0\r\no=live ${fingerprint} 1 IN IP4 0.0.0.0\r\ns=live-answer\r\nt=0 0\r\n`;
    await this.bus.setGrant(liveGrantKey(session.id, args.userId), `webrtc:${fingerprint}`, 300).catch(() => undefined);
    await this.bus
      .xadd(LIVE_STREAM, { event: 'live.webrtc.answered', sessionId: session.id, at: Date.now() })
      .catch(() => undefined);
    return { sessionId: session.id, webrtcSdpAnswer, expiresAt: new Date(Date.now() + 300 * 1000).toISOString() };
  }
}
