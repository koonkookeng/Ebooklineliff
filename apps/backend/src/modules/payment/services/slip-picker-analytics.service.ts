// SSOT Phase 016 §7.1 — Picker analytics ingest (client-observed checkout events)
// Canonical: apps/backend/src/modules/payment/services/slip-picker-analytics.service.ts
// Validates SlipPickerAnalyticsEvent and fans out to stream:analytics:payments.
// No Nest parameter decorators here so contract tests import it directly
// (tsx limitation — same pattern as the Phase-014 v1 boundary).
import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { SlipPickerAnalyticsEventSchema } from '@repo/shared';

@Injectable()
export class SlipPickerAnalyticsService {
  constructor(private readonly redis: RedisClusterService) {}

  /** Validates + publishes one picker event. Returns received:true (202-style ack). */
  async handleIngest(body: unknown, userId?: string): Promise<{ received: boolean }> {
    if (!userId) throw new UnauthorizedException('Unauthorized');
    const parsed = SlipPickerAnalyticsEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid picker analytics event');
    await this.redis
      .publish('stream:analytics:payments', JSON.stringify({ ...parsed.data, userId, at: new Date().toISOString() }))
      .catch(() => undefined);
    return { received: true };
  }
}
