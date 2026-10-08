// SSOT Phase 050 §5.2 — sliding-window rate guard on Redis (BDD anti-scraping)
// Canonical: apps/backend/src/modules/stream/guards/video-rate-limit.guard.ts
// (legacy src/backend/modules/stream/guards/video-rate-limit.guard.ts)
// - Normal playback ≈ 1 segment / 2s; cap 5 segs / 2s window (§5.2).
// - Burst (>8 counted in window) ⇒ 429 + weighted violation score; the
//   session service escalates to TEMPORARY_BLOCK / PERMANENT_BAN.
// - Fail-open on Redis outage (availability first; §10 false-positive rule).
// - Pure decision fn is exported for contract tests (no Nest runtime needed).
import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import {
  VIDEO_RATE_MAX_BURST_SEGMENTS,
  VIDEO_RATE_WINDOW_SEC,
  VIDEO_SCRAPE_BURST_PER_SEC,
  videoRateLimitKey,
} from '@repo/shared';

export interface VideoRateRedisPort {
  trackVideoSegment(key: string, windowSec: number): Promise<number>;
  incrementScrapingViolationScore(userId: string, clientIp: string, weight?: number): Promise<number>;
  setPlaybackHeartbeat(userId: string, lessonId: string): Promise<void>;
}

export function evaluateVideoRate(requestCount: number): { allowed: boolean; burst: boolean } {
  if (requestCount <= VIDEO_RATE_MAX_BURST_SEGMENTS) return { allowed: true, burst: false };
  return { allowed: false, burst: requestCount > VIDEO_SCRAPE_BURST_PER_SEC };
}

@Injectable()
export class VideoRateLimitGuard implements CanActivate {
  constructor(private readonly redis: VideoRateRedisPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as {
      user?: { id?: string };
      headers?: Record<string, string | undefined>;
      ip?: string;
      params?: Record<string, string | undefined>;
      query?: Record<string, string | undefined>;
    };
    const lessonId = request.params?.lessonId || request.query?.lessonId;
    const rawUser = request.user?.id || request.headers?.['x-user-id'];
    const clientIp =
      request.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || request.ip || 'unknown';
    const identity = rawUser || `ip:${clientIp}`;
    if (!lessonId) {
      throw new HttpException('Missing lesson scope', HttpStatus.BAD_REQUEST);
    }

    let requestCount = 0;
    try {
      requestCount = await this.redis.trackVideoSegment(
        videoRateLimitKey(identity, lessonId),
        VIDEO_RATE_WINDOW_SEC,
      );
    } catch {
      return true; // fail-open: never block paying viewers on cache outage
    }

    const verdict = evaluateVideoRate(requestCount);
    if (verdict.allowed) {
      await this.redis.setPlaybackHeartbeat(identity, lessonId).catch(() => undefined);
      return true;
    }

    await this.redis
      .incrementScrapingViolationScore(identity, clientIp, verdict.burst ? 25 : 10)
      .catch(() => 0);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Video segment download rate exceeded. Anti-scraping policy enforced.',
        retryAfterSec: VIDEO_RATE_WINDOW_SEC,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
