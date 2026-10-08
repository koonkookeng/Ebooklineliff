// SSOT Phase 053 §5.2 — HLS dynamic signed-token issuer (HMAC-SHA256, 60s TTL)
// Canonical: apps/backend/src/modules/stream/hls-token-generator.service.ts
// (legacy src/backend/modules/stream/hls-token-generator.service.ts)
// - Token wire: base64url(userId:lessonId:sessionId:ipHash:exp:signature).
// - Entitlement gate: Redis edge flag (<10ms) → Prisma Entitlement via
//   lesson → section → course → productId resolution (server-authoritative).
// - Session ledger: one VideoStreamSession row per issuance (reuse Phase 050
//   model; clientIpHash/userAgent are the Phase 053 additive columns).
// - Constructor takes ports — no Nest param decorators (tsx-importable).
import { Injectable, ForbiddenException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  HLS_SEGMENT_TOKEN_TTL_SEC,
  hlsTokenBody,
  isHlsTokenExpired,
  parseHlsTokenBody,
} from '@repo/shared';

export interface HlsTokenRedisPort {
  getEntitlementFlag(key: string): Promise<string | null>;
  setEntitlementFlag(key: string, ttlSeconds?: number): Promise<void>;
}

export interface HlsTokenDbPort {
  courseLesson: {
    findUnique(a: unknown): Promise<{ section: { course: { productId: string } } } | null>;
  };
  entitlement: {
    findUnique(a: unknown): Promise<{ expiresAt: Date | null } | null>;
  };
  videoStreamSession: {
    create(a: unknown): Promise<unknown>;
  };
}

export interface SignedPlaylistResult {
  masterPlaylistUrl: string;
  sessionToken: string;
  expiresInSeconds: number;
  watermarkPayload: { userIdHash: string; displayName: string; timestamp: string };
}

export function hashClientIp(clientIp: string): string {
  return createHash('sha256').update(clientIp).digest('hex').substring(0, 16);
}

@Injectable()
export class HlsTokenGeneratorService {
  private readonly ttlSec = HLS_SEGMENT_TOKEN_TTL_SEC;

  constructor(
    private readonly redis: HlsTokenRedisPort,
    private readonly db: HlsTokenDbPort,
    private readonly secret: string = process.env.HLS_HMAC_SECRET || 'ahong-emerald-secret-144-xz',
    private readonly cdnDomain: string = process.env.CLOUDFLARE_R2_CDN_DOMAIN || 'https://cdn.example.com',
  ) {}

  /** Mint a short-lived segment token bound to user + lesson + session + IP. */
  generateSignedSegmentToken(
    userId: string,
    lessonId: string,
    clientIp: string,
    sessionId: string,
  ): { token: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSec;
    const ipHash = hashClientIp(clientIp);
    const body = hlsTokenBody(userId, lessonId, sessionId, ipHash, expiresAt);
    const signature = createHmac('sha256', this.secret).update(body).digest('hex');
    return { token: Buffer.from(`${body}:${signature}`).toString('base64url'), expiresAt };
  }

  /** Verify integrity + expiry + IP binding; false on any mismatch (fail-closed). */
  verifySegmentToken(token: string, clientIp: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parsed = parseHlsTokenBody(decoded);
      if (!parsed) return false;
      if (isHlsTokenExpired(parsed.exp)) return false;
      if (parsed.ipHash !== hashClientIp(clientIp)) return false;
      const expected = createHmac('sha256', this.secret)
        .update(hlsTokenBody(parsed.userId, parsed.lessonId, parsed.sessionId, parsed.ipHash, parsed.exp))
        .digest('hex');
      const a = Buffer.from(parsed.signature, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Entitlement-gated master playlist issuance + session ledger row. */
  async getSignedMasterPlaylist(
    userId: string,
    lessonId: string,
    clientIp: string,
    userAgent: string,
    displayName = 'member',
  ): Promise<SignedPlaylistResult> {
    const allowed = await this.hasLessonAccess(userId, lessonId);
    if (!allowed) {
      throw new ForbiddenException('User lacks valid entitlement for this lesson');
    }
    const sessionId = randomUUID();
    const { token, expiresAt } = this.generateSignedSegmentToken(userId, lessonId, clientIp, sessionId);
    const ipHash = hashClientIp(clientIp);
    await this.db.videoStreamSession.create({
      data: {
        userId,
        lessonId,
        sessionToken: token,
        deviceFingerprint: ipHash,
        ipAddress: clientIp,
        clientIpHash: ipHash,
        userAgent,
        expiresAt: new Date(expiresAt * 1000),
      },
    });
    return {
      masterPlaylistUrl: `${this.cdnDomain}/courses/${lessonId}/master.m3u8?token=${token}`,
      sessionToken: token,
      expiresInSeconds: this.ttlSec,
      watermarkPayload: {
        userIdHash: createHash('sha256').update(userId).digest('hex').substring(0, 12),
        displayName,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async hasLessonAccess(userId: string, lessonId: string): Promise<boolean> {
    const flagKey = `entitlement:${userId}:${lessonId}`;
    const cached = await this.redis.getEntitlementFlag(flagKey).catch(() => null);
    if (cached) return true;
    const lesson = await this.db.courseLesson
      .findUnique({ where: { id: lessonId }, include: { section: { include: { course: true } } } })
      .catch(() => null);
    const productId = lesson?.section.course.productId;
    if (!productId) return false;
    const row = await this.db.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    if (!row) return false;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false;
    await this.redis.setEntitlementFlag(flagKey, 3600).catch(() => undefined);
    return true;
  }
}
