// SSOT Phase 050 §5.1/§7.1 — playback sessions + scraping analytics + ban engine
// Canonical: apps/backend/src/modules/stream/services/video-session.service.ts
// (legacy src/backend/modules/stream/services/video-session.service.ts)
// - Sessions gate every segment fetch; burst/ripper behavior escalates
//   WARNING_THROTTLE → TEMPORARY_BLOCK (30 min) → PERMANENT_BAN (score ≥ 100/5min).
// - DB writes stay off the hot path (Redis pipeline guards); persistence is
//   audit/ban state only (Gate 7). Zero new deps.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AntiScrapingViolationLogSchema,
  HlsStreamTokenRequestSchema,
  VIDEO_SCRAPE_RISK_BAN_THRESHOLD,
  VIDEO_SCRAPE_TEMP_BLOCK_SEC,
  isNonSequentialFetch,
} from '@repo/shared';

export interface VideoSessionRedisPort {
  setPlaybackHeartbeat(userId: string, lessonId: string): Promise<void>;
  incrementScrapingViolationScore(userId: string, clientIp: string, weight?: number): Promise<number>;
}

export interface VideoSessionDbPort {
  videoStreamSession: {
    create(a: unknown): Promise<{ id: string; sessionToken: string }>;
    update(a: unknown): Promise<unknown>;
    updateMany(a: unknown): Promise<{ count: number }>;
  };
  scraperBlacklist: {
    upsert(a: unknown): Promise<unknown>;
  };
}

export type SecurityAction = 'WARNING_THROTTLE' | 'TEMPORARY_BLOCK' | 'PERMANENT_BAN';

export function escalateAction(riskScore: number): SecurityAction {
  if (riskScore >= VIDEO_SCRAPE_RISK_BAN_THRESHOLD) return 'PERMANENT_BAN';
  if (riskScore >= 50) return 'TEMPORARY_BLOCK';
  return 'WARNING_THROTTLE';
}

@Injectable()
export class VideoSessionService {
  constructor(
    private readonly db: VideoSessionDbPort,
    private readonly redis: VideoSessionRedisPort,
  ) {}

  async createPlaybackSession(input: {
    lessonId: string;
    userId: string;
    lineUserId?: string;
    deviceFingerprint: string;
    ipAddress: string;
  }): Promise<{ playbackSessionId: string; sessionToken: string }> {
    const parsed = HlsStreamTokenRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Invalid stream token request: ${parsed.error.message}`);
    const sessionToken = randomUUID();
    const row = await this.db.videoStreamSession.create({
      data: {
        userId: input.userId,
        lessonId: input.lessonId,
        sessionToken,
        deviceFingerprint: input.deviceFingerprint,
        ipAddress: input.ipAddress,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await this.redis.setPlaybackHeartbeat(input.userId, input.lessonId).catch(() => undefined);
    return { playbackSessionId: row.id, sessionToken: row.sessionToken };
  }

  /** Out-of-order / parallel pulls ⇒ ripper bot: add weighted risk (fail-open). */
  async noteSegmentFetch(input: {
    userId: string;
    lessonId: string;
    ipAddress: string;
    userAgent: string;
    requestedIndex: number;
    expectedNextIndex: number;
  }): Promise<SecurityAction | null> {
    if (!isNonSequentialFetch(input.requestedIndex, input.expectedNextIndex)) return null;
    return this.recordViolation({ ...input, requestCountPerSec: VIDEO_SCRAPE_RISK_BAN_THRESHOLD, weight: 25 });
  }

  async recordViolation(input: {
    userId: string;
    lessonId: string;
    ipAddress: string;
    requestCountPerSec: number;
    userAgent: string;
    weight?: number;
  }): Promise<SecurityAction> {
    const parsed = AntiScrapingViolationLogSchema.safeParse({
      ...input,
      actionTaken: 'WARNING_THROTTLE',
    });
    if (!parsed.success) throw new Error(`Invalid violation log: ${parsed.error.message}`);
    const score = await this.redis
      .incrementScrapingViolationScore(input.userId, input.ipAddress, input.weight ?? 10)
      .catch(() => 0);
    const action = escalateAction(score);
    if (action !== 'WARNING_THROTTLE') {
      await this.revokeAllUserSessions(input.userId).catch(() => undefined);
      await this.db.scraperBlacklist
        .upsert({
          where: { id: `${input.userId}:${input.ipAddress}` },
          update: {
            violationCount: { increment: 1 },
            actionTaken: action,
            blockedUntil:
              action === 'TEMPORARY_BLOCK'
                ? new Date(Date.now() + VIDEO_SCRAPE_TEMP_BLOCK_SEC * 1000)
                : null,
          },
          create: {
            id: `${input.userId}:${input.ipAddress}`,
            userId: input.userId,
            ipAddress: input.ipAddress,
            reason: `HLS burst ${input.requestCountPerSec}/s (risk ${score})`,
            actionTaken: action,
            blockedUntil:
              action === 'TEMPORARY_BLOCK'
                ? new Date(Date.now() + VIDEO_SCRAPE_TEMP_BLOCK_SEC * 1000)
                : null,
          },
        })
        .catch(() => undefined);
    }
    return action;
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.db.videoStreamSession
      .update({ where: { sessionToken }, data: { isActive: false } })
      .catch(() => undefined);
  }

  async revokeAllUserSessions(userId: string): Promise<number> {
    const res = await this.db.videoStreamSession
      .updateMany({ where: { userId, isActive: true }, data: { isActive: false } })
      .catch(() => ({ count: 0 }));
    return res.count;
  }
}
