// SSOT Phase 119 Task 5 §8.1 — device-bound HLS playback ticket signer
// Canonical: apps/backend/src/modules/security/services/hls-token-signer.service.ts
// (legacy src/backend/modules/security/services/hls-token-signer.service.ts)
// - Short-lived playback tickets: HMAC(sessionToken|fingerprint|lesson|exp).
//   verifyTicket re-checks expiry + binding timing-safely. This is the 119
//   device-binding lane — segment AES-128 encryption itself stays in the 050
//   video-security lane (Zero Redundant; the key endpoint consults this
//   verdict before releasing keys).
// - Secret: explicit ctor arg wins, else HLS_TICKET_SECRET env, else the
//   documented development fallback (provision the env in prod).
// - Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function resolveHlsTicketSecret(explicit?: string): string {
  const raw = (explicit ?? process.env['HLS_TICKET_SECRET'] ?? '').trim();
  if (raw) return raw;
  return createHash('sha256').update('secret-key-144-xz/hls-ticket-fallback', 'utf8').digest('hex');
}

/** Short-lived playback ticket TTL (seconds). */
export const PLAYBACK_TICKET_TTL_SEC = 120;

export interface PlaybackTicket {
  ticket: string;
  expiresAt: string;
}

@Injectable()
export class HlsTokenSignerService {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = resolveHlsTicketSecret(secret);
    if (!this.secret) throw new Error('HLS ticket secret must not be empty');
  }

  mint(args: { sessionToken: string; fingerprintHash: string; lessonId: string; ttlSec?: number }): PlaybackTicket {
    if (!args.sessionToken || !args.fingerprintHash || !args.lessonId) throw new Error('Missing ticket binding');
    if (args.lessonId.includes('.')) throw new Error('Lesson id cannot contain dots');
    const exp = Math.floor(Date.now() / 1000) + (args.ttlSec ?? PLAYBACK_TICKET_TTL_SEC);
    const body = `${args.sessionToken}.${args.fingerprintHash}.${args.lessonId}.${exp}`;
    const sig = createHmac('sha256', this.secret).update(body, 'utf8').digest('hex');
    return { ticket: `${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  verify(ticket: string): { sessionToken: string; fingerprintHash: string; lessonId: string; exp: number } | null {
    const parts = ticket.split('.');
    if (parts.length !== 5) return null;
    const [sessionToken, fingerprintHash, lessonId, expRaw, sig] = parts as [string, string, string, string, string];
    const exp = Number(expRaw);
    if (!sessionToken || !fingerprintHash || !lessonId || !Number.isFinite(exp)) return null;
    if (exp * 1000 < Date.now()) return null;
    const body = `${sessionToken}.${fingerprintHash}.${lessonId}.${expRaw}`;
    const expected = createHmac('sha256', this.secret).update(body, 'utf8').digest('hex');
    if (sig.length !== expected.length) return null;
    try {
      if (!timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
    } catch {
      return null;
    }
    return { sessionToken, fingerprintHash, lessonId, exp };
  }
}
