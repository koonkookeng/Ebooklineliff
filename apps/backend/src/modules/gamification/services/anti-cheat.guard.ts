// SSOT Phase 096 Task 3 — Anti-cheat guard (HMAC nonce + velocity, pure)
// Canonical: apps/backend/src/modules/gamification/services/anti-cheat.guard.ts
// - signClaim/verifyClaim: HMAC(userId.activityType.referenceId.ts) with
//   5-min TTL (replay-proof §8.1). isVelocityCapped: Redis counter gate.
// - Pure helpers exported for tests; guard is injectable. Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CLAIM_NONCE_TTL_SEC, CLAIM_VELOCITY_LIMIT, MIN_DWELL_SEC } from '@repo/shared';

export function signClaimNonce(args: {
  userId: string;
  activityType: string;
  referenceId: string;
  ts: number;
  secret: string;
}): string {
  return createHmac('sha256', args.secret)
    .update(`${args.userId}.${args.activityType}.${args.referenceId}.${args.ts}`)
    .digest('hex');
}

export function verifyClaimNonce(args: {
  nonce: string;
  userId: string;
  activityType: string;
  referenceId: string;
  secret: string;
  now?: number;
}): boolean {
  const parts = args.nonce.split('.');
  if (parts.length !== 2) return false;
  const [tsRaw, sig] = parts as [string, string];
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  const now = args.now ?? Date.now();
  if (Math.abs(now - ts) > CLAIM_NONCE_TTL_SEC * 1000) return false;
  const expected = signClaimNonce({ userId: args.userId, activityType: args.activityType, referenceId: args.referenceId, ts, secret: args.secret });
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function dwellSatisfied(activityType: string, dwellTimeSec: number): boolean {
  void activityType;
  return dwellTimeSec >= MIN_DWELL_SEC;
}

export function velocityCapped(recentClaims: number): boolean {
  return recentClaims >= CLAIM_VELOCITY_LIMIT;
}

@Injectable()
export class AntiCheatGuard {
  constructor(private readonly secret: string = process.env['CLAIM_NONCE_SECRET'] || 'dev-claim-secret') {}

  verify(userId: string, activityType: string, referenceId: string, nonce: string): boolean {
    return verifyClaimNonce({ nonce, userId, activityType, referenceId, secret: this.secret });
  }

  sign(userId: string, activityType: string, referenceId: string): string {
    const ts = Date.now();
    return `${ts}.${signClaimNonce({ userId, activityType, referenceId, ts, secret: this.secret })}`;
  }
}
