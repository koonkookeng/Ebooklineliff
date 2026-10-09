// SSOT Phase 089 BDD-2 — Atomic gift claim (<1s, single-claim locked)
// Canonical: apps/backend/src/modules/gift/application/services/claim-gift.service.ts
// (legacy class name ClaimGiftServiceService renamed — no importers.)
// - Flow: Zod gate -> Redis claim mutex (409 on race, §8.1) -> READY+window
//   guard (graceful used/expired shapes, never 500) -> ONE $transaction:
//   CLAIMED stamp + recipient + 012 entitlement grant (Gate 7) -> K-factor
//   + sender-notify streams (Gate 8).
// - Entitlement writes reuse EntitlementGrantService (012 single writer).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ClaimGiftPayloadSchema, GIFT_STREAM, canClaim, giftClaimLockKey } from '@repo/shared';
import { assertClaimable } from '../../domain/entities/gift-order.entity';
import { GIFT_CLAIMED_EVENT } from '../../domain/events/gift-claimed.event';
import type { GiftRepository } from '../../domain/repository/gift.repository.interface';
import { EntitlementGrantService } from '../../../entitlement/services/entitlement-grant.service';

export interface ClaimTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface ClaimLockPort {
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class ClaimGiftService {
  constructor(
    private readonly repo: GiftRepository,
    private readonly locks: ClaimLockPort,
    private readonly tx: ClaimTx,
    private readonly grants: EntitlementGrantService,
  ) {}

  async execute(args: { recipientUserId: string; claimCode: string }): Promise<{
    success: boolean;
    message: string;
    productId: string | null;
  }> {
    const parsed = ClaimGiftPayloadSchema.safeParse({ claimCode: args.claimCode });
    if (!parsed.success) throw new BadRequestException('Invalid claim code');

    let locked = false;
    try {
      locked = (await this.locks.set(giftClaimLockKey(parsed.data.claimCode), args.recipientUserId, 'NX', 'EX', 10).catch(() => null)) === 'OK';
    } catch {
      locked = false;
    }
    if (!locked) throw new ConflictException('Gift claim is being processed — try again');

    const t0 = Date.now();
    try {
      const gift = await this.repo.findByClaimCode(parsed.data.claimCode);
      if (!gift) {
        return { success: false, message: 'ไม่พบของขวัญรหัสนี้', productId: null };
      }
      try {
        assertClaimable(
          { status: gift.status, expiresAt: new Date(gift.expiresAt).getTime(), claimCode: gift.claimCode },
          t0,
        );
      } catch (e) {
        const claimed = gift.status === 'CLAIMED';
        return {
          success: false,
          message: claimed ? 'ของขวัญชิ้นนี้ถูกรับไปแล้ว' : (e as Error).message,
          productId: null,
        };
      }
      if (gift.senderUserId === args.recipientUserId) {
        return { success: false, message: 'ไม่สามารถรับของขวัญของตัวเองได้', productId: null };
      }

      await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        await repo.claimAtomic({ giftId: gift.id, recipientUserId: args.recipientUserId });
        await this.grants.grantForOrder(tx as never, args.recipientUserId, [gift.productId]);
      });

      await this.locks
        .xaddPipeline(GIFT_STREAM, [
          {
            event: GIFT_CLAIMED_EVENT,
            giftId: gift.id,
            claimCode: gift.claimCode,
            senderUserId: gift.senderUserId,
            recipientUserId: args.recipientUserId,
            productId: gift.productId,
            tookMs: Date.now() - t0,
            at: Date.now(),
          },
        ])
        .catch(() => undefined);
      return { success: true, message: 'รับของขวัญสำเร็จ', productId: gift.productId };
    } finally {
      await this.locks.del(giftClaimLockKey(parsed.data.claimCode)).catch(() => undefined);
    }
  }
}
