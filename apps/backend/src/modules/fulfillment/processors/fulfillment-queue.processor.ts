// SSOT Phase 076 §5.2 — Fulfillment queue processor (FIFO drain worker)
// Canonical: apps/backend/src/modules/fulfillment/processors/fulfillment-queue.processor.ts
// - RISK_CALL deviation (documented): @nestjs/bullmq is NOT installed
//   (agent.md Deny heavy deps); the processor drains the same BullMQ job
//   shape ({ orderId, courierProvider, tenantId } on
//   `fulfillment:booking-queue`) via a port-based FIFO loop with
//   concurrency 10 — the BullMQ WorkerHost attaches here when the dep lands.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { FulfillmentQueueService } from '../services/fulfillment-queue.service';

export interface FulfillmentJob {
  orderId: string;
  courierProvider: string;
  tenantId: string;
  batchId: string;
  warehouseId: string;
}

@Injectable()
export class FulfillmentQueueProcessor {
  private readonly logger = new Logger(FulfillmentQueueProcessor.name);

  constructor(private readonly queue: FulfillmentQueueService) {}

  /** Drain one batch through the booking pipeline (concurrency 10). */
  async drain(batchId: string, tenantId: string, jobs: FulfillmentJob[]): Promise<{
    booked: number; failed: Array<{ orderId: string; reason: string }>;
  }> {
    this.logger.log(`Draining fulfillment batch ${batchId} (${jobs.length} jobs)`);
    const failed: Array<{ orderId: string; reason: string }> = [];
    let booked = 0;
    for (let i = 0; i < jobs.length; i += 10) {
      const chunk = jobs.slice(i, i + 10);
      const out = await Promise.all(
        chunk.map((j) =>
          this.queue.drainBatch(batchId, tenantId, [j.orderId]).then(
            (r) => ({ ok: r.booked, fail: r.failed }),
            (e: Error) => ({ ok: 0, fail: [{ orderId: j.orderId, reason: e.message }] }),
          ),
        ),
      );
      for (const r of out) {
        booked += r.ok;
        failed.push(...r.fail);
      }
    }
    return { booked, failed };
  }
}
