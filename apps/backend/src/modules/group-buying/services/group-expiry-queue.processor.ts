// SSOT Phase 090 BDD-2 — Expiry queue processor (scheduler entry-point)
// Canonical: apps/backend/src/modules/group-buying/services/group-expiry-queue.processor.ts
// - Thin cron/queue adapter: delegates to GroupExpiryService. Wire your
//   scheduler (BullMQ/cron) to `sweep()` at TTL cadence. Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { GroupExpiryService } from '../application/services/group-expiry.service';

@Injectable()
export class GroupExpiryQueueProcessor {
  private readonly logger = new Logger(GroupExpiryQueueProcessor.name);

  constructor(private readonly expiry: GroupExpiryService) {}

  async sweep(now = Date.now()): Promise<{ expired: number }> {
    const r = await this.expiry.expireUnclaimed(now);
    if (r.expired > 0) this.logger.log(`group-buy expired ${r.expired} rooms`);
    return r;
  }
}
