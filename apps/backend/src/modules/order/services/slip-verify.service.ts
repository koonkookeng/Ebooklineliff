// SSOT Phase 012 BDD — Slip verify orchestrator (<1s atomic: lock → EasySlip → txn → events)
// Canonical: apps/backend/src/modules/order/services/slip-verify.service.ts
// SLA: 800ms EasySlip budget + single $transaction; breaches emit a monitor alert
// (money already moved — never fail post-grant, alert instead).
// Phase 013: expected amount honors the active PromptPayTransaction total
// (fractional-cent matching); the txn flips it PAID; failures feed the
// PromptPay fraud guard (optional — keeps Phase-012 constructions compiling).
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  SlipVerificationResultSchema,
  type SlipVerificationResult,
} from '@repo/shared';
import { EasySlipVerifyAdapter, SlipUnverifiableError } from '../../payment/services/easyslip-verify.adapter';
import { EntitlementGrantService } from '../../entitlement/services/entitlement-grant.service';
import type { PromptPayGuardService } from '../../payment/services/promptpay-guard.service';

const LOCK_TTL_SEC = 10;
const SLA_MS = 1000;

const toNum = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return (v as { toNumber(): number }).toNumber() ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

@Injectable()
export class SlipVerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly easyslip: EasySlipVerifyAdapter,
    private readonly grants: EntitlementGrantService,
    // Optional (no @Optional decorator — tsx contract tests run without
    // experimentalDecorators; Nest resolves via design:paramtypes metadata).
    // OrderModule imports PromptPayModule so runtime resolution succeeds.
    private readonly guard?: PromptPayGuardService,
  ) {}

  async verify(orderId: string, slipImageUrl: string, actorUserId: string): Promise<SlipVerificationResult> {
    if (!orderId) throw new BadRequestException('Missing order id');
    if (!slipImageUrl?.startsWith('http')) throw new BadRequestException('Invalid slip image URL');
    const t0 = Date.now();
    const lockKey = `lock:slip_verify:${orderId}`;
    const locked = await this.redis.setnx(lockKey, actorUserId, LOCK_TTL_SEC).catch(() => true);
    if (!locked) throw new ConflictException('Verification in progress for this order. Please wait.');
    try {
      const order = await this.prisma.order
        .findUnique({
          where: { id: orderId },
          include: { orderItems: { select: { productId: true } } },
        })
        .catch(() => null);
      if (!order || order.userId !== actorUserId) throw new NotFoundException('Order not found');
      // Phase 013: expired QRs are dead — the user must regenerate first
      // (regeneration resets the order to PENDING_PAYMENT atomically).
      if (order.orderStatus === 'EXPIRED') {
        throw new BadRequestException('QR หมดอายุแล้ว กรุณาสร้าง QR Code ใหม่');
      }
      if (order.paymentStatus === 'VERIFIED') {
        return this.result(orderId, 'Order already verified', order.orderStatus as SlipVerificationResult['orderStatus'], 'VERIFIED', null, order.orderItems.map((i) => i.productId));
      }
      await this.prisma.order
        .update({ where: { id: orderId }, data: { orderStatus: 'PAYMENT_VERIFYING', paymentStatus: 'PENDING_SLIP' } })
        .catch(() => null);

      let slip;
      try {
        slip = await this.easyslip.verify(slipImageUrl);
      } catch (e) {
        await this.markFailed(orderId, 'PENDING_SLIP');
        await this.guard?.recordSlipFailure(actorUserId).catch(() => undefined);
        throw new BadRequestException(e instanceof SlipUnverifiableError ? e.message : 'Slip verification unavailable');
      }
      // Phase 013: fractional-cent matching — the slip must cover the active
      // QR total when one exists (overpay tolerated, underpay rejected).
      const netAmount = toNum(order.netAmount, 0);
      const expectedAmount = await this.activeQrTotal(orderId, netAmount);
      if (slip.amount < expectedAmount) {
        await this.markFailed(orderId, 'PENDING_SLIP');
        await this.guard?.recordSlipFailure(actorUserId).catch(() => undefined);
        throw new BadRequestException(`Payment amount (${slip.amount}) does not match order amount (${expectedAmount})`);
      }
      const expectedAccount = (process.env.COMPANY_PROMPTPAY_ACCOUNT ?? '').replace(/\D/g, '');
      if (expectedAccount && slip.receiverAccount !== expectedAccount) {
        await this.markFailed(orderId, 'PENDING_SLIP');
        await this.guard?.recordSlipFailure(actorUserId).catch(() => undefined);
        throw new BadRequestException('Recipient account does not match enterprise account');
      }

      const granted = await this.prisma.$transaction(async (tx) => {
        const db = tx as unknown as {
          paymentSlip: { upsert: (args: unknown) => Promise<unknown> };
          order: { update: (args: unknown) => Promise<unknown> };
          promptPayTransaction: { updateMany: (args: unknown) => Promise<unknown> };
        };
        await db.paymentSlip.upsert({
          where: { orderId },
          create: {
            orderId, slipImageUrl, transRef: slip.transRef, sendingBank: slip.senderBank,
            receivingAccount: slip.receiverAccount, amount: netAmount, verifiedAt: new Date(), apiRawResponse: slip.raw as never,
          },
          update: {
            slipImageUrl, transRef: slip.transRef, sendingBank: slip.senderBank,
            receivingAccount: slip.receiverAccount, amount: netAmount, verifiedAt: new Date(), apiRawResponse: slip.raw as never,
          },
        });
        await db.order.update({ where: { id: orderId }, data: { orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED' } });
        // Phase 013: close the QR lifecycle in the same atomic transaction.
        await db.promptPayTransaction
          .updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'PAID' } })
          .catch(() => null);
        return this.grants.grantForOrder(
          tx as never,
          order.userId,
          order.orderItems.map((i) => i.productId),
          'FULL_PURCHASE',
        );
      });

      const latencyMs = Date.now() - t0;
      await this.emit('stream:payment:slip-verified', { orderId, userId: order.userId, latencyMs, transRef: slip.transRef });
      if (latencyMs > SLA_MS) {
        await this.emit('stream:monitor:sla-breach', { flow: 'slip-verify', orderId, latencyMs });
      }
      await this.guard?.clearOnSuccess(actorUserId).catch(() => undefined);
      await this.emit('stream:notify:flex-receipt', { orderId, userId: order.userId, productIds: granted });
      return this.result(orderId, 'Slip verified and access unlocked successfully.', 'COMPLETED', 'VERIFIED', slip.transRef, granted);
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  private result(
    orderId: string,
    message: string,
    orderStatus: SlipVerificationResult['orderStatus'],
    paymentStatus: SlipVerificationResult['paymentStatus'],
    transRef: string | null,
    entitlementsGranted: string[],
  ): SlipVerificationResult {
    const parsed = SlipVerificationResultSchema.safeParse({
      success: true, message, orderId, orderStatus, paymentStatus, transRef, entitlementsGranted,
    });
    if (!parsed.success) throw new BadRequestException('Verification result contract drift');
    return parsed.data;
  }

  private async markFailed(orderId: string, paymentStatus: 'PENDING_SLIP' | 'FAILED'): Promise<void> {
    await this.prisma.order.update({ where: { id: orderId }, data: { paymentStatus } }).catch(() => null);
  }

  /** Phase 013: live QR total for fractional-cent matching (falls back to net). */
  private async activeQrTotal(orderId: string, netAmount: number): Promise<number> {
    const db = this.prisma as unknown as {
      promptPayTransaction: {
        findFirst: (args: unknown) => Promise<{ totalAmount: unknown } | null>;
      };
    };
    const txn = await db.promptPayTransaction
      ?.findFirst({ where: { orderId, status: 'PENDING', expiresAt: { gt: new Date() } } })
      .catch(() => null);
    return Math.max(netAmount, toNum(txn?.totalAmount, netAmount));
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
