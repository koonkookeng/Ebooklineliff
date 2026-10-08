// SSOT Phase 070 Task 4 — SessionHandshakeService (QR handoff + guard)
// Canonical: apps/backend/src/modules/auth/session-handshake.service.ts
// (legacy src/backend/modules/auth/session-handshake.service.ts)
// - issueHandshake (desktop, JWT): uuid token → Redis SETEX 120s (payload
//   userId + redirect) + Prisma audit row → { token, expiresAt, redirect }.
// - authorizeHandshake (LIFF, JWT): Redis GETDEL single-use (replay-safe) →
//   viewport guard (≤2 recent viewports per user; ActiveDeviceSession stays
//   schema-untouched per 057) → audit update → session fingerprint.
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { HANDSHAKE_TTL_SEC, MAX_ACTIVE_VIEWPORTS, handshakeRedisKey } from '@repo/shared';

export interface HandshakeCache {
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  getdel(key: string): Promise<string | null>;
}

export interface HandshakeTables {
  handshakeToken: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<{ lineUserId: string; isConsumed: boolean; expiresAt: Date } | null>;
    update(args: unknown): Promise<unknown>;
  };
  activeDeviceSession: {
    countRecent?(userId: string, sinceMs: number): Promise<number>;
    findMany?(args: unknown): Promise<Array<{ socketId: string; lastActiveAt: Date }>>;
  };
}

interface HandshakePayload {
  userId: string;
  lineUserId: string;
  targetRedirectUrl: string;
  issuedAt: number;
}

@Injectable()
export class SessionHandshakeService {
  constructor(
    private readonly tables?: HandshakeTables,
    private readonly cache?: HandshakeCache,
  ) {}

  async issueHandshake(
    userId: string,
    lineUserId: string,
    targetRedirectUrl: string,
  ): Promise<{ ok: boolean; handshakeToken?: string; expiresAt?: string; targetRedirectUrl?: string; error?: string }> {
    if (!this.tables || !this.cache) return { ok: false, error: 'UNAVAILABLE' };
    if (!userId || !targetRedirectUrl) return { ok: false, error: 'INVALID_INPUT' };
    const handshakeToken = randomUUID();
    const expiresAt = new Date(Date.now() + HANDSHAKE_TTL_SEC * 1000).toISOString();
    const payload: HandshakePayload = { userId, lineUserId, targetRedirectUrl, issuedAt: Date.now() };
    await this.cache.setex(handshakeRedisKey(handshakeToken), HANDSHAKE_TTL_SEC, JSON.stringify(payload)).catch(() => undefined);
    await this.tables.handshakeToken
      .create({ data: { handshakeToken, lineUserId, expiresAt: new Date(expiresAt) } })
      .catch(() => null);
    return { ok: true, handshakeToken, expiresAt, targetRedirectUrl };
  }

  /** Active viewport guard (BDD-4): max 2 recent viewports, schema-untouched. */
  async viewportCount(userId: string, windowMs = 5 * 60 * 1000): Promise<number> {
    if (!this.tables?.activeDeviceSession?.countRecent) return 0;
    return this.tables.activeDeviceSession.countRecent(userId, Date.now() - windowMs).catch(() => 0);
  }

  async authorizeHandshake(
    userId: string,
    handshakeToken: string,
    webSessionId: string,
  ): Promise<{ ok: boolean; sessionFingerprint?: string; error?: string }> {
    if (!this.tables || !this.cache) return { ok: false, error: 'UNAVAILABLE' };
    const raw = await this.cache.getdel(handshakeRedisKey(String(handshakeToken))).catch(() => null);
    if (!raw) return { ok: false, error: 'TOKEN_INVALID_OR_CONSUMED' };
    let payload: HandshakePayload;
    try {
      payload = JSON.parse(raw) as HandshakePayload;
    } catch {
      return { ok: false, error: 'TOKEN_INVALID_OR_CONSUMED' };
    }
    if (payload.userId !== userId) return { ok: false, error: 'TOKEN_USER_MISMATCH' };
    const active = await this.viewportCount(userId);
    if (active >= MAX_ACTIVE_VIEWPORTS) return { ok: false, error: 'DEVICE_LIMIT' };
    await this.tables.handshakeToken
      .update({ where: { handshakeToken }, data: { isConsumed: true, webSessionId } })
      .catch(() => undefined);
    return { ok: true, sessionFingerprint: `${userId.slice(0, 8)}:${webSessionId.slice(0, 8)}:${Date.now().toString(36)}` };
  }
}
