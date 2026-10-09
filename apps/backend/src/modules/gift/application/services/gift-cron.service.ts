// SSOT Phase 089 BDD-3/Task 7 — Gift expiry sweeper (30d revert, cron-ready)
// Canonical: apps/backend/src/modules/gift/application/services/gift-cron.service.ts
// (legacy class name GiftCronServiceService renamed — no importers.)
// - expireUnclaimed: READY + past-expiry rows → EXPIRED_REVERTED +
//   entitlement reverted to the SENDER (same txn) + OA-notify stream.
//   Invoke at midnight from your scheduler (no new deps).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { GIFT_STREAM } from '@repo/shared';
import { GIFT_EXPIRED_EVENT } from '../../domain/events/gift-expired.event';
import type { GiftRepository } from '../../domain/repository/gift.repository.interface';
import { EntitlementGrantService } from '../../../entitlement/services/entitlement-grant.service';

export interface GiftCronTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface GiftCronBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class GiftCronService {
  constructor(
    private readonly repo: GiftRepository,
    private readonly tx: GiftCronTx,
    private readonly bus: GiftCronBus,
    private readonly grants: EntitlementGrantService,
  ) {}

  async expireUnclaimed(now = Date.now(), limit = 200): Promise<{ reverted: number }> {
    const due = await this.repo.expireDue(new Date(now), limit);
    let reverted = 0;
    for (const gift of due) {
      try {
        await this.tx.run(async (tx) => {
          const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
          await repo.revertToSender(gift.id);
          await this.grants.grantForOrder(tx as never, gift.senderUserId, [gift.productId]);
        });
        await this.bus
          .xadd(GIFT_STREAM, {
            event: GIFT_EXPIRED_EVENT,
            giftId: gift.id,
            senderUserId: gift.senderUserId,
            productId: gift.productId,
            at: Date.now(),
          })
          .catch(() => undefined);
        reverted++;
      } catch {
        // Next midnight retries; rows stay READY until flipped.
      }
    }
    return { reverted };
  }
}
