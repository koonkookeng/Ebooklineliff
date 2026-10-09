// SSOT Phase 090 BDD-2/Task 4 — Group expiry sweeper (24h wallet refund)
// Canonical: apps/backend/src/modules/group-buying/application/services/group-expiry.service.ts
// - expireUnclaimed: WAITING + past-expiry rows → EXPIRED + wallet refund
//   (User.walletBalance increment, same txn) + OA-notify stream.
//   Invoke at TTL from your scheduler (no new deps — BullMQ optional).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { GROUP_STREAM } from '@repo/shared';
import { GROUP_ROOM_EXPIRED_EVENT } from '../../domain/events/group.events';
import type { GroupRepository } from '../../domain/repository/group.repository.interface';

export interface GroupExpiryTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface GroupExpiryBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface WalletRefundPort {
  refundToWallet(tx: unknown, userId: string, amount: number): Promise<void>;
}

@Injectable()
export class GroupExpiryService {
  constructor(
    private readonly repo: GroupRepository,
    private readonly tx: GroupExpiryTx,
    private readonly bus: GroupExpiryBus,
    private readonly refunds: WalletRefundPort,
  ) {}

  async expireUnclaimed(now = Date.now(), limit = 200): Promise<{ expired: number }> {
    const due = await this.repo.expireDue(new Date(now), limit);
    let expired = 0;
    for (const room of due) {
      try {
        await this.tx.run(async (tx) => {
          const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
          await repo.markExpired(room.id);
          const full = await repo.findById(room.id);
          const members = full?.members ?? [];
          for (const m of members) {
            if (!m.orderId.startsWith('pending:')) {
              await this.refunds.refundToWallet(tx, m.userId, room.discountedPrice);
            }
          }
        });
        await this.bus
          .xadd(GROUP_STREAM, {
            event: GROUP_ROOM_EXPIRED_EVENT,
            roomId: room.id,
            productId: room.productId,
            at: Date.now(),
          })
          .catch(() => undefined);
        expired++;
      } catch {
        // Next sweep retries; rows stay WAITING until flipped.
      }
    }
    return { expired };
  }
}
