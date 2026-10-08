// SSOT Phase 052 §5.2 — analytics fan-in (Redis Stream, non-blocking, 0ms DB latency)
// Canonical: apps/backend/src/modules/analytics/services/analytics-stream.service.ts
// (legacy src/backend/modules/analytics/services/analytics-stream.service.ts)
// - Validated batches land in `stream:analytics:events` via ONE pipeline
//   round-trip; the batch writer (processor) owns all PostgreSQL writes.
// - Constructor takes ports — no Nest param decorators (tsx-importable).
import { Injectable } from '@nestjs/common';
import {
  ANALYTICS_STREAM_KEY,
  type AnalyticsBatchIngestPayload,
} from '@repo/shared';

export interface AnalyticsStreamRedisPort {
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class AnalyticsStreamService {
  constructor(private readonly redis: AnalyticsStreamRedisPort) {}

  async pushToStream(payload: AnalyticsBatchIngestPayload): Promise<{ queued: number }> {
    const batch: Array<Record<string, string | number>> = [];
    for (const e of payload.readEvents) {
      batch.push({
        type: 'READ',
        userId: e.userId,
        ebookId: e.ebookId,
        productId: e.productId,
        pageNumber: e.pageNumber,
        dwellTimeSec: e.dwellTimeSec,
        scrollDepth: e.scrollDepthPercentage ?? 100,
        payload: JSON.stringify(e),
      });
    }
    for (const e of payload.watchEvents) {
      batch.push({
        type: 'WATCH',
        userId: e.userId,
        lessonId: e.lessonId,
        productId: e.productId,
        watchedSec: e.watchedSec,
        currentTimestampSec: e.currentTimestampSec,
        durationSec: e.durationSec,
        payload: JSON.stringify(e),
      });
    }
    await this.redis.xaddPipeline(ANALYTICS_STREAM_KEY, batch);
    return { queued: batch.length };
  }
}
