// SSOT Phase 112 Task 2 §7.1 — moderation async worker (in-process FIFO)
// Canonical: apps/backend/src/modules/moderation/queues/moderation.processor.ts
// (legacy src/backend/modules/moderation/queues/moderation.processor.ts)
// - Repo doctrine (Phase 038/043/052): in-process FIFO instead of BullMQ
//   (zero new deps). Upload/webhook paths enqueue; this worker drains via
//   the engine with per-item SLA timing. Fail-open per item (one poison
//   product never wedges the queue); stats stay observable.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { MODERATION_SCAN_SLA_MS, type ModerationContentType } from '@repo/shared';
import { ModerationEngineService, type ScanInputs } from '../services/moderation-engine.service';

export interface ModerationJob {
  productId: string;
  contentType: ModerationContentType;
  inputs?: ScanInputs;
  tenantName?: string;
  enqueuedAt: number;
}

export interface ModerationDrainStats {
  drained: number;
  passed: number;
  quarantined: number;
  failed: number;
  slaBreaches: number;
  pending: number;
}

@Injectable()
export class ModerationQueueProcessor {
  private readonly logger = new Logger(ModerationQueueProcessor.name);
  private readonly fifo: ModerationJob[] = [];

  constructor(private readonly engine: ModerationEngineService) {}

  /** Stage a validated scan job (called by upload/webhook/rescan paths). */
  enqueue(job: Omit<ModerationJob, 'enqueuedAt'>): number {
    this.fifo.push({ ...job, enqueuedAt: Date.now() });
    return this.fifo.length;
  }

  pending(): number {
    return this.fifo.length;
  }

  async drain(maxItems = 25): Promise<ModerationDrainStats> {
    const batch = this.fifo.splice(0, Math.max(1, maxItems));
    const stats: ModerationDrainStats = { drained: batch.length, passed: 0, quarantined: 0, failed: 0, slaBreaches: 0, pending: this.fifo.length };
    for (const job of batch) {
      try {
        const verdict = await this.engine.processContentModeration(job.productId, { contentType: job.contentType, ...job.inputs }, job.tenantName ?? 'default');
        if (verdict.status === 'PASSED') stats.passed++;
        else stats.quarantined++;
        if (verdict.elapsedMs > MODERATION_SCAN_SLA_MS) stats.slaBreaches++;
      } catch (err) {
        stats.failed++;
        this.logger.warn(`Moderation job failed for ${job.productId}: ${(err as Error).message}`);
      }
    }
    stats.pending = this.fifo.length;
    return stats;
  }

  /** 10s cadence starter (wired by the module on bootstrap in prod). */
  startAutoDrain(intervalMs = 10_000): NodeJS.Timeout {
    return setInterval(() => {
      void this.drain();
    }, intervalMs);
  }
}
