// SSOT Phase 113 Task 3 §5.1 — escrow auto-release cron (7-day sweep)
// Canonical: apps/backend/src/modules/escrow/escrow.cron.ts
// (legacy src/backend/modules/escrow/escrow.cron.ts)
// - runOnce() is pure orchestration over EscrowService.releaseDue (per-item
//   fail-open inside); start() wires the hourly cadence in prod. The module
//   does NOT auto-start (tests stay deterministic; bootstrap calls start()).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { EscrowService } from './escrow.service';

/** Hourly sweep cadence for matured escrow holds. */
export const ESCROW_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class EscrowReleaseCron {
  private readonly logger = new Logger(EscrowReleaseCron.name);

  constructor(private readonly escrow: EscrowService) {}

  async runOnce(nowMs: number, limit = 50): Promise<{ released: number; failed: number }> {
    const out = await this.escrow.releaseDue(nowMs, limit);
    if (out.released > 0 || out.failed > 0) {
      this.logger.log(`Escrow sweep: released=${out.released} failed=${out.failed}`);
    }
    return out;
  }

  start(intervalMs = ESCROW_SWEEP_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      void this.runOnce(Date.now()).catch((err: Error) => this.logger.warn(`Escrow sweep failed: ${err.message}`));
    }, intervalMs);
  }
}
