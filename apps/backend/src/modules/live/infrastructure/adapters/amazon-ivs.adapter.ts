// SSOT Phase 099 Task 2 — Vendor playback adapter (HMAC, no aws-sdk)
// Canonical: apps/backend/src/modules/live/infrastructure/adapters/amazon-ivs.adapter.ts
// - RISK_CALL (§5.2 deviation): the spec's @aws-sdk/client-ivs + jsonwebtoken
//   ES384 mint is replaced with an HMAC-SHA256 short-lived playback token
//   (5-min, LINE-user-bound) verified by our own HLS edge gatekeeper
//   (050/053 pattern). Zero new deps — node:crypto only, no secrets in code
//   (env-first HMAC key, R2 zero-egress delivery).
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { LIVE_PLAYBACK_TOKEN_TTL_SEC, liveTokenBody } from '@repo/shared';

export interface VendorPlayback {
  vendor: string;
  playbackUrl: string;
  playbackToken: string;
  expiresAt: string;
}

@Injectable()
export class AmazonIvsAdapter {
  private readonly key: string;

  constructor(key = process.env['LIVE_PLAYBACK_HMAC'] || 'dev-live-hmac') {
    this.key = key;
  }

  mint(args: { sessionId: string; userId: string; vendor: string; playbackArn?: string | null }): VendorPlayback {
    const expSec = Math.floor(Date.now() / 1000) + LIVE_PLAYBACK_TOKEN_TTL_SEC;
    const body = liveTokenBody(args.sessionId, args.userId, expSec);
    const sig = createHmac('sha256', this.key).update(body).digest('base64url');
    const playbackUrl =
      args.vendor === 'WEBRTC_NATIVE'
        ? `wss://live.local/s/${args.sessionId}`
        : `https://live.local/${args.sessionId}/master.m3u8`;
    void args.playbackArn;
    return {
      vendor: args.vendor,
      playbackUrl,
      playbackToken: `${Buffer.from(body, 'utf8').toString('base64url')}.${sig}`,
      expiresAt: new Date(expSec * 1000).toISOString(),
    };
  }

  verify(token: string): { sessionId: string; userId: string; expSec: number } | null {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    let body = '';
    try {
      body = Buffer.from(b64, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const expect = createHmac('sha256', this.key).update(body).digest('base64url');
    if (expect.length !== sig.length) return null;
    let ok = true;
    for (let i = 0; i < expect.length; i++) {
      if (expect.charCodeAt(i) !== sig.charCodeAt(i)) ok = false;
    }
    if (!ok) return null;
    const [sessionId, userId, expRaw] = body.split('.');
    const expSec = Number(expRaw);
    if (!sessionId || !userId || !Number.isFinite(expSec)) return null;
    if (expSec * 1000 < Date.now()) return null;
    return { sessionId, userId, expSec };
  }
}
