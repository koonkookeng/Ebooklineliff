// SSOT Phase 101 §5.1 — Socket handshake entitlement guard (fail-closed)
// Canonical: apps/backend/src/gateways/live-socket/guards/live-socket.guard.ts
// - Verifies the 100-gatekeeper playback token (HMAC, 30s) before any room
//   subscription; expired/forged tokens are rejected without a session.
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface HandshakeVerifier {
  verifyToken(token: string): { liveRoomId: string; userId: string } | null;
}

@Injectable()
export class LiveSocketGuard {
  constructor(private readonly verifier: HandshakeVerifier) {}

  canActivate(args: { sessionId: string; token: string }): { userId: string } | null {
    if (!args.sessionId || !args.token) return null;
    const v = this.verifier.verifyToken(args.token);
    if (!v || v.liveRoomId !== args.sessionId) return null;
    return { userId: v.userId };
  }
}
