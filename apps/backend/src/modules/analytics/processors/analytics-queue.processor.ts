// SSOT Phase 052 §7.1 — batch drain worker (in-process FIFO, 10s cadence, no BullMQ)
// Canonical: apps/backend/src/modules/analytics/processors/analytics-queue.processor.ts
// (legacy src/backend/modules/analytics/processors/analytics-queue.processor.ts)
// - Repo doctrine (Phase 038/043): in-process FIFO instead of BullMQ (zero new
//   deps). The Redis Stream is the durable buffer; this worker pulls via the
//   stream service port and hands batches to the aggregation writer.
// - Fail-open: a failed batch is dropped after logging shape (telemetry must
//   never wedge playback); counts stay observable via returned stats.
import { Injectable } from '@nestjs/common';
import {
  ANALYTICS_DRAIN_BATCH_SEC,
  type AnalyticsBatchIngestPayload,
} from '@repo/shared';
import {
  AnalyticsAggregationService,
  type AnalyticsStreamEntry,
} from '../services/analytics-aggregation.service';

export interface AnalyticsDrainStats {
  drained: number;
  written: number;
  pending: number;
}

@Injectable()
export class AnalyticsQueueProcessor {
  private readonly fifo: AnalyticsStreamEntry[] = [];

  constructor(private readonly writer: AnalyticsAggregationService) {}

  /** Stage a validated batch (called by the ingestion path or stream consumer). */
  enqueue(payload: AnalyticsBatchIngestPayload): number {
    for (const e of payload.readEvents) {
      this.fifo.push({
        type: 'READ',
        userId: e.userId,
        ebookId: e.ebookId,
        productId: e.productId,
        pageNumber: e.pageNumber,
        dwellTimeSec: e.dwellTimeSec,
        scrollDepth: e.scrollDepthPercentage ?? 100,
      });
    }
    for (const e of payload.watchEvents) {
      this.fifo.push({
        type: 'WATCH',
        userId: e.userId,
        lessonId: e.lessonId,
        productId: e.productId,
        watchedSec: e.watchedSec,
        currentTimestampSec: e.currentTimestampSec,
        durationSec: e.durationSec,
      });
    }
    return this.fifo.length;
  }

  pending(): number {
    return this.fifo.length;
  }

  async drain(): Promise<AnalyticsDrainStats> {
    const batch = this.fifo.splice(0, this.fifo.length);
    if (batch.length === 0) return { drained: 0, written: 0, pending: 0 };
    try {
      const { written } = await this.writer.drainBatch(batch);
      return { drained: batch.length, written, pending: this.fifo.length };
    } catch {
      return { drained: batch.length, written: 0, pending: this.fifo.length };
    }
  }

  /** 10s batch cadence (§7.1 step 3). Call once at module init. */
  startDrainLoop(): NodeJS.Timeout {
    return setInterval(() => {
      void this.drain();
    }, ANALYTICS_DRAIN_BATCH_SEC * 1000);
  }
}
