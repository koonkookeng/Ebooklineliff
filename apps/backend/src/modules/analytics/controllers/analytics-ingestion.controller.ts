// SSOT Phase 052 §5.2 — ingestion gateway (JWT, 30/min shield, 202 async)
// Canonical: apps/backend/src/modules/analytics/controllers/analytics-ingestion.controller.ts
// (legacy src/backend/modules/analytics/controllers/analytics-ingestion.controller.ts)
// - Zod at the edge; server STAMPS userId from JWT (client ids untrusted).
// - 30 pulses/min/user fixed window (§8.2) via Redis incr+expire; 429 on abuse.
// - 202 Accepted: Redis Stream write is the only I/O on the hot path (<25ms).
import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  AnalyticsBatchIngestSchema,
  analyticsPulseKey,
} from '@repo/shared';
import { isPulseAllowed, stampAnalyticsIdentity } from '../dto/analytics-payload.dto';
import { AnalyticsStreamService } from '../services/analytics-stream.service';

interface AnalyticsReq {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

@Controller('api/v1/analytics')
export class AnalyticsIngestionController {
  constructor(
    private readonly stream: AnalyticsStreamService,
    private readonly redis: RedisClusterService,
  ) {}

  @Post('pulse')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async receiveAnalyticsPulse(@Body() rawBody: unknown, @Req() req: AnalyticsReq) {
    const userId = req.user?.id;
    if (!userId) return { success: false, status: 'UNAUTHORIZED' };
    const parsed = AnalyticsBatchIngestSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return { success: false, status: 'INVALID', errors: parsed.error.flatten() };
    }
    const bucket = Math.floor(Date.now() / 60000);
    const count = await this.redis.incr(analyticsPulseKey(userId, bucket)).catch(() => 0);
    if (count === 1) await this.redis.expire(analyticsPulseKey(userId, bucket), 60).catch(() => undefined);
    if (!isPulseAllowed(count)) {
      throw new HttpException('Telemetry pulse rate exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    // Server-authoritative identity: never trust client-stamped userIds (Gate 4).
    const stamped = stampAnalyticsIdentity(parsed.data, userId);
    const { queued } = await this.stream.pushToStream(stamped);
    return { success: true, status: 'QUEUED', queued, timestamp: new Date().toISOString() };
  }
}
