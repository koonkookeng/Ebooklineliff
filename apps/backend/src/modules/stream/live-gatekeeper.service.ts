// SSOT Phase 100 Task 3 — Live gatekeeper (edge-first <100ms + 30s tokens)
// Canonical: apps/backend/src/modules/stream/live-gatekeeper.service.ts
// - validateAndIssuePlaybackToken: Redis edge verdict (60s) → room/product
//   entitlement fallback → room-full + concurrent guards → 30s HMAC token +
//   session row + watermark + kick fan-out on device rotation.
// - heartbeat: 15s re-validation (expiry/kick/device) → OK/KICKED + log.
// - RISK_CALL: HMAC tokens (no JWT lib), SSE kick fan-out (no WS lib).
//   Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import {
  LIVE_DEVICE_TTL_SEC,
  LIVE_EDGE_CACHE_TTL_SEC,
  LIVE_EPHEMERAL_TOKEN_TTL_SEC,
  LIVE_GATE_STREAM,
  LIVE_HEARTBEAT_INTERVAL_SEC,
  LIVE_KICK_CHANNEL,
  liveDeviceKey,
  liveEdgeKey,
  liveEphemeralBody,
  liveUserHash,
} from '@repo/shared';
import type { LiveGatekeeperRepository } from './services/live-gatekeeper.repository';

export interface GateCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface GateResult {
  accessStatus: string;
  playbackToken: string | null;
  hlsStreamUrl: string | null;
  tokenExpiresAt: number;
  heartbeatIntervalSec: number;
  watermarkPayload: { userIdHash: string; displayName: string; ipAddress: string; timestamp: string };
}

const BLANK_WATERMARK = { userIdHash: '', displayName: '', ipAddress: '', timestamp: '' };

function denied(status: string): GateResult {
  return {
    accessStatus: status,
    playbackToken: null,
    hlsStreamUrl: null,
    tokenExpiresAt: 0,
    heartbeatIntervalSec: LIVE_HEARTBEAT_INTERVAL_SEC,
    watermarkPayload: { ...BLANK_WATERMARK },
  };
}

@Injectable()
export class LiveGatekeeperService {
  constructor(
    private readonly repo: LiveGatekeeperRepository,
    private readonly edge: GateCache,
    private readonly hmacKey = process.env['LIVE_GATE_HMAC'] || 'dev-live-gate',
    private readonly watermarkSalt = process.env['LIVE_WATERMARK_SALT'] || 'dev-live-salt',
  ) {}

  private sign(body: string): string {
    return createHmac('sha256', this.hmacKey).update(body).digest('base64url');
  }

  /** Edge-proxy verification for ephemeral playback tokens (30s, HMAC). */
  verifyToken(token: string): { liveRoomId: string; userId: string; sessionToken: string; expSec: number } | null {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    let body = '';
    try {
      body = Buffer.from(b64, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const expect = this.sign(body);
    if (expect.length !== sig.length) return null;
    let ok = true;
    for (let i = 0; i < expect.length; i++) {
      if (expect.charCodeAt(i) !== sig.charCodeAt(i)) ok = false;
    }
    if (!ok) return null;
    const [liveRoomId, userId, sessionToken, expRaw] = body.split('.');
    const expSec = Number(expRaw);
    if (!liveRoomId || !userId || !sessionToken || !Number.isFinite(expSec)) return null;
    if (expSec * 1000 < Date.now()) return null;
    return { liveRoomId, userId, sessionToken, expSec };
  }

  async validateAndIssuePlaybackToken(args: {
    userId: string;
    liveRoomId: string;
    deviceFingerprint: string;
    clientIp: string;
  }): Promise<GateResult> {
    const t0 = Date.now();
    const edgeKey = liveEdgeKey(args.liveRoomId, args.userId);
    let verdict = await this.edge.get(edgeKey).catch(() => null);
    if (verdict === null) {
      verdict = (await this.checkEntitlement(args.liveRoomId, args.userId)) ? '1' : '0';
      await this.edge.set(edgeKey, verdict, 'EX', LIVE_EDGE_CACHE_TTL_SEC).catch(() => undefined);
    }
    if (verdict !== '1') {
      const expired = await this.checkExpired(args.liveRoomId, args.userId).catch(() => false);
      return denied(expired ? 'DENIED_EXPIRED' : 'DENIED_NO_ENTITLEMENT');
    }

    const room = await this.repo.findRoom(args.liveRoomId);
    if (!room || room.streamStatus === 'ENDED' || room.streamStatus === 'ARCHIVED') {
      return denied('DENIED_NO_ENTITLEMENT');
    }
    const active = await this.repo.countActiveSessions(args.liveRoomId).catch(() => 0);
    if (active >= room.maxAllowedSeats) return denied('DENIED_ROOM_FULL');

    // Concurrent device guard: one active device per room+user.
    const deviceKey = liveDeviceKey(args.liveRoomId, args.userId);
    const incumbent = await this.edge.get(deviceKey).catch(() => null);
    if (incumbent && incumbent !== args.deviceFingerprint) {
      await this.repo.kickUserSessions(args.liveRoomId, args.userId, 'CONCURRENT_DEVICE_LOGIN').catch(() => undefined);
      await this.edge
        .publish(LIVE_KICK_CHANNEL, JSON.stringify({ roomId: args.liveRoomId, userId: args.userId, reason: 'CONCURRENT_DEVICE_LOGIN', actionTimestamp: new Date().toISOString() }))
        .catch(() => undefined);
    }
    await this.edge.set(deviceKey, args.deviceFingerprint, 'EX', LIVE_DEVICE_TTL_SEC).catch(() => undefined);

    const sessionToken = randomUUID();
    await this.repo
      .upsertSession({
        liveRoomId: args.liveRoomId,
        userId: args.userId,
        sessionToken,
        deviceFingerprint: args.deviceFingerprint,
        ipAddress: args.clientIp,
      })
      .catch(() => undefined);

    const expSec = Math.floor(Date.now() / 1000) + LIVE_EPHEMERAL_TOKEN_TTL_SEC;
    const body = liveEphemeralBody(args.liveRoomId, args.userId, sessionToken, expSec);
    const playbackToken = `${Buffer.from(body, 'utf8').toString('base64url')}.${this.sign(body)}`;
    const user = await this.repo.findUser(args.userId).catch(() => null);
    const userIdHash = liveUserHash(`${args.userId}:${args.liveRoomId}`, this.watermarkSalt);
    await this.edge
      .xaddPipeline(LIVE_GATE_STREAM, [{ event: 'live.token.issued', roomId: args.liveRoomId, tookMs: Date.now() - t0, at: Date.now() }])
      .catch(() => undefined);
    return {
      accessStatus: 'GRANTED',
      playbackToken,
      hlsStreamUrl: `${room.hlsPlaybackUrl}?token=${playbackToken}`,
      tokenExpiresAt: expSec,
      heartbeatIntervalSec: LIVE_HEARTBEAT_INTERVAL_SEC,
      watermarkPayload: {
        userIdHash,
        displayName: user?.displayName ?? 'VIP Viewer',
        ipAddress: args.clientIp,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async heartbeat(args: {
    sessionToken: string;
    liveRoomId: string;
    userId: string;
    currentPlaybackSec: number;
    deviceFingerprint: string;
    clientIp: string;
    skipDeviceCheck?: boolean;
  }): Promise<{ status: 'OK' | 'KICKED'; nextHeartbeatMs: number }> {
    const session = await this.repo.findSessionByToken(args.sessionToken).catch(() => null);
    if (!session || session.isKicked || session.liveRoomId !== args.liveRoomId || session.userId !== args.userId) {
      return { status: 'KICKED', nextHeartbeatMs: 0 };
    }
    const room = await this.repo.findRoom(args.liveRoomId).catch(() => null);
    if (!room || room.streamStatus === 'ENDED' || room.streamStatus === 'ARCHIVED') {
      return { status: 'KICKED', nextHeartbeatMs: 0 };
    }
    // GQL callers without a device fingerprint rely on session-token secrecy.
    if (!args.skipDeviceCheck) {
      const incumbent = await this.edge.get(liveDeviceKey(args.liveRoomId, args.userId)).catch(() => null);
      if (!incumbent || incumbent !== args.deviceFingerprint) {
        return { status: 'KICKED', nextHeartbeatMs: 0 };
      }
      await this.edge.set(liveDeviceKey(args.liveRoomId, args.userId), args.deviceFingerprint, 'EX', LIVE_DEVICE_TTL_SEC).catch(() => undefined);
    }
    const verdict = await this.edge.get(liveEdgeKey(args.liveRoomId, args.userId)).catch(() => null);
    if (verdict === '0') return { status: 'KICKED', nextHeartbeatMs: 0 };
    if (verdict === null) {
      const ok = await this.checkEntitlement(args.liveRoomId, args.userId).catch(() => false);
      if (!ok) {
        await this.edge.set(liveEdgeKey(args.liveRoomId, args.userId), '0', 'EX', LIVE_EDGE_CACHE_TTL_SEC).catch(() => undefined);
        return { status: 'KICKED', nextHeartbeatMs: 0 };
      }
    }
    await this.repo.touchSession(args.sessionToken).catch(() => undefined);
    await this.repo
      .logHeartbeat({ liveRoomId: args.liveRoomId, userId: args.userId, playbackSec: Math.floor(args.currentPlaybackSec), clientIp: args.clientIp })
      .catch(() => undefined);
    return { status: 'OK', nextHeartbeatMs: LIVE_HEARTBEAT_INTERVAL_SEC * 1000 };
  }

  async kickSession(args: { liveRoomId: string; userId: string; reason: string }): Promise<{ kicked: number }> {
    const n = await this.repo.kickUserSessions(args.liveRoomId, args.userId, args.reason).catch(() => 0);
    await this.edge.del(liveDeviceKey(args.liveRoomId, args.userId)).catch(() => undefined);
    await this.edge
      .publish(LIVE_KICK_CHANNEL, JSON.stringify({ roomId: args.liveRoomId, userId: args.userId, reason: args.reason, actionTimestamp: new Date().toISOString() }))
      .catch(() => undefined);
    return { kicked: n };
  }

  private async checkEntitlement(liveRoomId: string, userId: string): Promise<boolean> {
    const direct = await this.repo.findRoomEntitlement(liveRoomId, userId).catch(() => null);
    if (direct?.isGranted && (!direct.expiresAt || direct.expiresAt.getTime() > Date.now())) return true;
    const room = await this.repo.findRoom(liveRoomId).catch(() => null);
    if (room?.linkedProductId) {
      const product = await this.repo.findProductEntitlement(userId, room.linkedProductId).catch(() => null);
      if (product && (!product.expiresAt || product.expiresAt.getTime() > Date.now())) return true;
      return false;
    }
    // Open room (no paywall linkage): free entry while LIVE_NOW/SCHEDULED.
    return !room?.isPaywallActive;
  }

  private async checkExpired(liveRoomId: string, userId: string): Promise<boolean> {
    const direct = await this.repo.findRoomEntitlement(liveRoomId, userId).catch(() => null);
    if (direct && direct.expiresAt && direct.expiresAt.getTime() <= Date.now()) return true;
    const room = await this.repo.findRoom(liveRoomId).catch(() => null);
    if (room?.linkedProductId) {
      const product = await this.repo.findProductEntitlement(userId, room.linkedProductId).catch(() => null);
      if (product?.expiresAt && product.expiresAt.getTime() <= Date.now()) return true;
    }
    return false;
  }
}
