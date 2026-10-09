// SSOT Phase 084 Task 3 — Abandoned cart service (detect → recover → analyze)
// Canonical: apps/backend/src/modules/messaging/services/abandoned-cart.service.ts
// - markAbandoned: ownership + non-empty + status guards → ABANDONED stamp,
//   15-min watch key, cart_abandoned stream (Gate 8). Payment core untouched.
// - recover: HMAC magic-link verify → cart + coupon-window resolve → ONE
//   $transaction: RECOVERED stamp + log click-through (Gate 7) → session
//   (<500ms BDD-2) with auto-applied discount + coupon code.
// - analytics: abandoned/recovered counts + revenue + rate (creator view).
// - Structural Prisma/Redis (078–083 precedent). Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  ABANDON_STEP1_IDLE_MIN,
  ABANDON_STEP2_IDLE_MIN,
  CART_RECOVERY_STREAM,
  RECOVERY_COUPON_TTL_SEC,
  abandonWatchKey,
  recoveryRate,
  verifyRecoveryToken,
} from '@repo/shared';

export interface CartSessionItem {
  productId: string;
  title: string;
  coverImageUrl: string;
  price: number;
  quantity: number;
}

@Injectable()
export class AbandonedCartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  /** Operator/user marks a cart abandoned (also called by the idle watcher). */
  async markAbandoned(actorUserId: string, cartId: string): Promise<{ cartId: string; status: string }> {
    const db = this.prisma as unknown as {
      cart: {
        findUnique(a: unknown): Promise<{ id: string; userId: string; status: string; items: Array<{ id: string }> } | null>;
        update(a: unknown): Promise<{ id: string; status: string }>;
      };
    };
    const cart = await db.cart.findUnique({ where: { id: cartId }, include: { items: true } }).catch(() => null);
    if (!cart) throw new BadRequestException('Cart not found');
    if (cart.userId !== actorUserId) throw new BadRequestException('Cart does not belong to actor');
    if (cart.items.length === 0) throw new BadRequestException('Cannot abandon an empty cart');
    if (cart.status !== 'ACTIVE') return { cartId: cart.id, status: cart.status };
    const updated = await db.cart.update({
      where: { id: cartId },
      data: { status: 'ABANDONED', abandonedAt: new Date() },
    });
    try {
      await this.redis.setex(abandonWatchKey(cartId), ABANDON_STEP1_IDLE_MIN * 60, '1');
    } catch {
      // Watch key is advisory; the sweeper compares timestamps.
    }
    try {
      await this.redis.xaddPipeline(CART_RECOVERY_STREAM, [
        { event: 'cart.abandoned', cartId, userId: actorUserId, at: Date.now() },
      ]);
    } catch {
      // Telemetry never breaks cart flows.
    }
    return { cartId: updated.id, status: updated.status };
  }

  /** Magic-link recovery: verify → resolve → atomic RECOVERED + session. */
  async recover(recoveryToken: string, secret: string): Promise<{
    success: boolean;
    message: string;
    cartSession: {
      cartId: string;
      userId: string;
      status: string;
      items: CartSessionItem[];
      totalAmount: number;
      discountAmount: number;
      recoveryCouponCode: string | null;
      expiresAt: string | null;
    } | null;
  }> {
    const cartId = verifyRecoveryToken(secret, recoveryToken);
    if (!cartId) {
      return { success: false, message: 'ลิงก์กู้คืนหมดอายุหรือไม่ถูกต้อง', cartSession: null };
    }
    const db = this.prisma as unknown as {
      cart: {
        findUnique(a: unknown): Promise<{
          id: string; userId: string; status: string;
          items: Array<{ productId: string; quantity: number; price: unknown; product: { title: string; coverImageUrl: string; price: unknown } }>;
        } | null>;
      };
      abandonedCartLog: {
        findMany(a: unknown): Promise<Array<{ id: string; step: string; couponCode: string | null; sentAt: Date }>>;
        updateMany(a: unknown): Promise<unknown>;
      };
    };
    const cart = await db.cart
      .findUnique({ where: { id: cartId }, include: { items: { include: { product: true } } } })
      .catch(() => null);
    if (!cart || cart.items.length === 0) {
      return { success: false, message: 'ตะกร้าไม่พร้อมกู้คืน — เลือกซื้อสินค้าต่อ', cartSession: null };
    }
    const logs = await db.abandonedCartLog
      .findMany({ where: { cartId }, orderBy: { sentAt: 'desc' } })
      .catch(() => []);
    const latest = logs[0];
    const couponLive =
      latest?.couponCode && Date.now() - new Date(latest.sentAt).getTime() < RECOVERY_COUPON_TTL_SEC * 1000
        ? latest
        : null;

    const items: CartSessionItem[] = cart.items.map((i) => {
      const unit = Number((i.price as { toString(): string } | null)?.toString?.() ?? (i.product.price as { toString(): string }).toString());
      return {
        productId: i.productId,
        title: i.product.title,
        coverImageUrl: i.product.coverImageUrl,
        price: unit,
        quantity: i.quantity,
      };
    });
    const totalAmount = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;

    const tx = this.prisma as unknown as {
      $transaction<T>(fn: (t: {
        cart: { update(a: unknown): Promise<unknown> };
        abandonedCartLog: { updateMany(a: unknown): Promise<unknown> };
      }) => Promise<T>): Promise<T>;
    };
    await tx.$transaction(async (t) => {
      await t.cart.update({
        where: { id: cartId },
        data: { status: 'RECOVERED', recoveredAt: new Date() },
      });
      if (latest) {
        await t.abandonedCartLog.updateMany({
          where: { cartId },
          data: { isClicked: true, clickedAt: new Date() },
        });
      }
    });

    try {
      await this.redis.xaddPipeline(CART_RECOVERY_STREAM, [
        { event: 'cart.recovered', cartId, totalAmount, at: Date.now() },
      ]);
    } catch {
      // Telemetry never breaks recovery.
    }

    const discountPct = !latest ? 0 : latest.step === 'STEP_1_15_MIN' ? 10 : 15;
    const discountAmount = Math.round(totalAmount * (discountPct / 100) * 100) / 100;
    return {
      success: true,
      message: 'กู้คืนรายการสินค้าและปรับใช้ส่วนลดพิเศษเรียบร้อยแล้ว',
      cartSession: {
        cartId,
        userId: cart.userId,
        status: 'RECOVERED',
        items,
        totalAmount,
        discountAmount,
        recoveryCouponCode: couponLive?.couponCode ?? null,
        expiresAt: couponLive ? new Date(new Date(couponLive.sentAt).getTime() + RECOVERY_COUPON_TTL_SEC * 1000).toISOString() : null,
      },
    };
  }

  /** Carts idle past a step threshold with no sent log (sweeper input). */
  async dueCarts(step: 'STEP_1_15_MIN' | 'STEP_2_3_HOURS', now = Date.now()): Promise<Array<{ id: string }>> {
    const thresholdMin = step === 'STEP_1_15_MIN' ? ABANDON_STEP1_IDLE_MIN : ABANDON_STEP2_IDLE_MIN;
    const db = this.prisma as unknown as {
      cart: {
        findMany(a: unknown): Promise<Array<{ id: string; logs: Array<{ step: string }> }>>;
      };
    };
    const rows = await db.cart
      .findMany({
        where: {
          status: { in: ['ACTIVE', 'ABANDONED'] },
          lastActivityAt: { lt: new Date(now - thresholdMin * 60_000) },
        },
        include: { logs: true },
      })
      .catch(() => []);
    return rows.filter((c) => !c.logs.some((l) => l.step === step)).map((c) => ({ id: c.id }));
  }

  /** Creator analytics: abandonment funnel + recovery rate (BDD >28% goal). */
  async analytics(tenantId: string): Promise<{
    totalAbandonedCount: number;
    recoveredCount: number;
    recoveredRevenue: number;
    recoveryRatePercentage: number;
  }> {
    const db = this.prisma as unknown as {
      cart: {
        count(a: unknown): Promise<number>;
        aggregate(a: unknown): Promise<{ _sum: { id?: unknown } }>;
        findMany(a: unknown): Promise<Array<{ items: Array<{ quantity: number; price: unknown; product: { price: unknown } }> }>>;
      };
    };
    const [abandoned, recovered] = await Promise.all([
      db.cart.count({ where: { tenantId, status: { in: ['ABANDONED', 'RECOVERED'] } } }).catch(() => 0),
      db.cart.count({ where: { tenantId, status: 'RECOVERED' } }).catch(() => 0),
    ]);
    const rows = await db.cart
      .findMany({
        where: { tenantId, status: 'RECOVERED' },
        include: { items: { include: { product: true } } },
      })
      .catch(() => []);
    const revenue =
      Math.round(
        rows.reduce(
          (s, c) =>
            s +
            c.items.reduce((t, i) => {
              const unit = Number((i.price as { toString(): string } | null)?.toString?.() ?? (i.product.price as { toString(): string }).toString());
              return t + unit * i.quantity;
            }, 0),
          0,
        ) * 100,
      ) / 100;
    return {
      totalAbandonedCount: abandoned,
      recoveredCount: recovered,
      recoveredRevenue: revenue,
      recoveryRatePercentage: recoveryRate(recovered, abandoned),
    };
  }
}
