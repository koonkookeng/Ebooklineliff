// SSOT Phase 013 §5 — Dynamic PromptPay QR engine (fractional cent + TTL lifecycle)
// Canonical: apps/backend/src/modules/payment/services/promptpay-qr.service.ts
// (legacy src/backend/modules/payment/services/promptpay-qr.service.ts)
// EMVCo payload reuses the Phase-012 builder (single CRC source); QR pixels
// render client-side via react-qr-code (zero-egress, zero new deps).
// Regeneration from EXPIRED resets the order to PENDING_PAYMENT atomically.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  CreatePromptPayQRInputSchema,
  PromptPayQRPayloadSchema,
  PromptPayExpiryStatusSchema,
  type PromptPayQRPayload,
  type PromptPayExpiryStatus,
} from '@repo/shared';
import { buildPromptPayPayload, type PromptPayProxyType } from './promptpay-emv.builder';
import { PromptPayGuardService } from './promptpay-guard.service';
import { OrderExpiryService } from '../../order/services/order-expiry.service';

const GENERATABLE = new Set(['PENDING_PAYMENT', 'EXPIRED']);
const MAX_CENT_TRIES = 50;

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

function merchantTarget(): { proxyType: PromptPayProxyType; proxyValue: string } {
  const proxyValue = process.env.COMPANY_PROMPTPAY_ID ?? '';
  const proxyType = (process.env.COMPANY_PROMPTPAY_TYPE ?? 'MOBILE') as PromptPayProxyType;
  if (!proxyValue) throw new BadRequestException('Merchant PromptPay account is not configured');
  return { proxyType, proxyValue };
}

type PrismaLike = {
  order: {
    findUnique: (args: unknown) => Promise<{
      id: string; userId: string; orderNumber: string; tenantId: string | null;
      netAmount: unknown; orderStatus: string; paymentStatus: string;
    } | null>;
  };
  promptPayTransaction: {
    findFirst: (args: unknown) => Promise<{ id: string; totalAmount: unknown; status: string; expiresAt: Date } | null>;
    findUnique: (args: unknown) => Promise<{
      id: string; status: string; expiresAt: Date; baseAmount: unknown;
      fractionalCent: unknown; totalAmount: unknown; qrPayload: string;
      orderNumber?: string; ref1: string; ref2: string | null;
    } | null>;
    upsert: (args: unknown) => Promise<{ expiresAt: Date }>;
  };
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
};

@Injectable()
export class PromptPayQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly guard: PromptPayGuardService,
    private readonly expiry: OrderExpiryService,
  ) {}

  /** Generates (or regenerates) a time-bound dynamic QR for a payable order. */
  async generateDynamicQR(
    actorUserId: string,
    raw: { orderId: string; expireMinutes?: number; useFractionalCent?: boolean },
  ): Promise<PromptPayQRPayload> {
    if (!actorUserId) throw new BadRequestException('Missing user id');
    const parsed = CreatePromptPayQRInputSchema.safeParse({
      orderId: raw.orderId,
      expireMinutes: raw.expireMinutes ?? 15,
      useFractionalCent: raw.useFractionalCent ?? true,
    });
    if (!parsed.success) throw new BadRequestException('Invalid QR request payload');
    const { orderId, expireMinutes, useFractionalCent } = parsed.data;

    await this.guard.assertAllowed(actorUserId);

    const db = this.prisma as unknown as PrismaLike;
    const order = await db.order
      .findUnique({ where: { id: orderId } })
      .catch(() => null);
    if (!order || order.userId !== actorUserId) throw new NotFoundException('Order not found');
    if (!GENERATABLE.has(order.orderStatus)) {
      throw new BadRequestException('คำสั่งซื้อไม่ถูกต้องหรือได้รับการชำระเงินแล้ว');
    }

    const baseAmount = Math.round(toNum(order.netAmount, 0) * 100) / 100;
    if (!(baseAmount > 0)) throw new BadRequestException('Order amount must be positive');

    let fractionalCent = 0;
    if (useFractionalCent) {
      fractionalCent = await this.allocateUniqueCent(baseAmount, orderId);
    }
    const totalAmount = Math.round((baseAmount + fractionalCent) * 100) / 100;
    const target = merchantTarget();
    const ref1 = order.orderNumber.replace(/[^a-zA-Z0-9]/g, '').slice(-15) || order.id.replace(/-/g, '').slice(-15);
    const qrCodePayload = buildPromptPayPayload(target, totalAmount, ref1);
    const expiresAt = new Date(Date.now() + expireMinutes * 60_000);

    await db.$transaction(async (tx) => {
      const t = tx as unknown as {
        promptPayTransaction: { upsert: (args: unknown) => Promise<unknown> };
        order: { update: (args: unknown) => Promise<unknown> };
      };
      await t.promptPayTransaction.upsert({
        where: { orderId },
        create: {
          orderId, promptPayId: target.proxyValue, qrPayload: qrCodePayload, ref1,
          baseAmount, fractionalCent, totalAmount, expiresAt, status: 'PENDING',
        },
        update: {
          promptPayId: target.proxyValue, qrPayload: qrCodePayload, ref1, ref2: null,
          baseAmount, fractionalCent, totalAmount, expiresAt, status: 'PENDING',
        },
      });
      if (order.orderStatus === 'EXPIRED') {
        await t.order.update({
          where: { id: orderId },
          data: { orderStatus: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' },
        });
      }
    }).catch((e) => {
      throw e instanceof BadRequestException || e instanceof NotFoundException
        ? e
        : new BadRequestException('Failed to issue QR transaction');
    });

    await this.redis.setex(`pp_expiry:${orderId}`, expireMinutes * 60, orderId).catch(() => undefined);
    await this.emit('stream:payment:qr-generated', {
      orderId, userId: actorUserId, baseAmount, fractionalCent, totalAmount,
      expiresAt: expiresAt.toISOString(),
    });

    const payload = {
      qrCodePayload,
      orderNumber: order.orderNumber,
      reference1: ref1,
      baseAmount,
      fractionalCent,
      totalAmount,
      expiresAt: expiresAt.toISOString(),
      timeRemainingSec: expireMinutes * 60,
    };
    const checked = PromptPayQRPayloadSchema.safeParse(payload);
    if (!checked.success) throw new BadRequestException('QR payload contract drift');
    return checked.data;
  }

  /** Owner-guarded QR status read with lazy expiry (expired PENDING flips inline). */
  async getStatus(actorUserId: string, orderId: string): Promise<PromptPayExpiryStatus> {
    if (!actorUserId) throw new BadRequestException('Missing user id');
    if (!orderId) throw new BadRequestException('Missing order id');
    const db = this.prisma as unknown as PrismaLike;
    const order = await db.order.findUnique({ where: { id: orderId } }).catch(() => null);
    if (!order || order.userId !== actorUserId) throw new NotFoundException('Order not found');
    if (order.paymentStatus === 'VERIFIED' || order.orderStatus === 'COMPLETED') {
      return this.status(orderId, 'PAID', false);
    }
    const txn = await db.promptPayTransaction.findUnique({ where: { orderId } }).catch(() => null);
    if (!txn) {
      return this.status(orderId, order.orderStatus === 'EXPIRED' ? 'EXPIRED' : 'PENDING', order.orderStatus === 'EXPIRED');
    }
    if (txn.status === 'PAID') return this.status(orderId, 'PAID', false);
    if (txn.status === 'CANCELLED') return this.status(orderId, 'CANCELLED', true);
    if (txn.status === 'EXPIRED' || txn.expiresAt.getTime() <= Date.now()) {
      await this.expiry.expireOrder(orderId, 'QR_STATUS_LAZY');
      return this.status(orderId, 'EXPIRED', true);
    }
    return this.status(orderId, 'PENDING', false);
  }

  private status(orderId: string, status: PromptPayExpiryStatus['status'], isExpired: boolean): PromptPayExpiryStatus {
    const parsed = PromptPayExpiryStatusSchema.safeParse({ orderId, status, isExpired });
    if (!parsed.success) throw new BadRequestException('QR status contract drift');
    return parsed.data;
  }

  /** Allocates a 0.01–0.99 cent never colliding with live PENDING totals; 0.00 fallback + alert. */
  private async allocateUniqueCent(baseAmount: number, orderId: string): Promise<number> {
    const db = this.prisma as unknown as PrismaLike;
    for (let i = 0; i < MAX_CENT_TRIES; i++) {
      const centVal = (Math.floor(Math.random() * 99) + 1) / 100;
      const targetTotal = Math.round((baseAmount + centVal) * 100) / 100;
      const clash = await db.promptPayTransaction
        .findFirst({ where: { totalAmount: targetTotal, status: 'PENDING', expiresAt: { gt: new Date() } } })
        .catch(() => null);
      if (!clash) return centVal;
    }
    await this.emit('stream:payment:fractional-collision', { orderId, baseAmount });
    return 0;
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
