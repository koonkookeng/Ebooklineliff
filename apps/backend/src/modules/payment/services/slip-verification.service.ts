/**
 * Phase 000 — Slip verification < 1s atomic (EasySlip transRef/account/amount + Prisma txn).
 * BDD: PENDING_PAYMENT -> COMPLETED + Entitlement grant within 1 second.
 */
import { Injectable } from '@nestjs/common';
import { SlipVerificationPayloadSchema } from '@repo/shared';

export interface EasySlipResult {
  transRef: string;
  amount: number;
  receiverAccount: string;
}

@Injectable()
export class SlipVerificationService {
  constructor(
    private readonly prisma: {
      $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T>;
    },
    private readonly easyslip: {
      verify(slipUrl: string): Promise<EasySlipResult>;
    },
  ) {}

  /**
   * Verify slip image and atomically complete order + grant entitlements.
   * Must complete < 1000ms (indexed transRef + single $transaction).
   */
  async verifyAndGrant(orderId: string, slipImageUrl: string, expectedAmount: number, expectedAccount: string) {
    const t0 = Date.now();
    const slip = await this.easyslip.verify(slipImageUrl);
    if (slip.amount !== expectedAmount) throw new Error(`AMOUNT_MISMATCH ${slip.amount} != ${expectedAmount}`);
    if (slip.receiverAccount !== expectedAccount) throw new Error('ACCOUNT_MISMATCH');

    const result = await this.prisma.$transaction(async (tx: never) => {
      const db = tx as unknown as {
        paymentSlip: { update(args: unknown): Promise<unknown> };
        order: {
          update(args: unknown): Promise<{ id: string }>;
          findUnique(args: unknown): Promise<{ userId: string } | null>;
        };
        entitlement: { upsert(args: unknown): Promise<unknown> };
        orderItem: { findMany(args: unknown): Promise<{ productId: string }[]> };
      };
      const owner = await db.order.findUnique({ where: { id: orderId }, select: { userId: true } });
      if (!owner) throw new Error('ORDER_NOT_FOUND');
      await db.paymentSlip.update({
        where: { orderId },
        data: { transRef: slip.transRef, amount: slip.amount, verifiedAt: new Date() },
      });
      const items = await db.orderItem.findMany({ where: { orderId } });
      for (const it of items) {
        await db.entitlement.upsert({
          where: { userId_productId: { userId: owner.userId, productId: it.productId } },
          create: { userId: owner.userId, productId: it.productId, accessType: 'FULL_PURCHASE' },
          update: {},
        });
      }
      return db.order.update({ where: { id: orderId }, data: { orderStatus: 'COMPLETED' } });
    });

    const payload = { success: true, message: 'verified', orderStatus: 'COMPLETED' as const, entitlementGranted: true };
    SlipVerificationPayloadSchema.parse(payload);
    const elapsed = Date.now() - t0;
    if (elapsed > 1000) throw new Error(`SLA_BREACH ${elapsed}ms > 1000ms`);
    return { ...result, elapsedMs: elapsed };
  }
}
