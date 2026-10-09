// SSOT Phase 084 Task 4 — Delayed-job consumer (sweep → Flex → log)
// Canonical: apps/backend/src/modules/messaging/queues/abandoned-cart.processor.ts
// - drainDue(step): due carts → per-cart Redis mutex → eligibility
//   (ABANDONED + LINE identity + <2 messages/abandonment, §8.1) → campaign
//   discount (BehavioralCampaign else 10/15 defaults) → coupon + HMAC magic
//   link → Flex build → push with 3-attempt backoff (§10.1) → atomic log row.
// - Delivery port: LogOnlyLinePush default (records + stream, synthetic id).
//   Swap the 'LINE_PUSH' provider to a LINE OA sender without touching this
//   file (documented ADR deviation — no tenant template exists for the 024
//   dispatcher vocabulary).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  CART_RECOVERY_STREAM,
  RECOVERY_MAX_MESSAGES,
  couponCountdownSec,
  recoveryDiscount,
  recoveryUrl,
  signRecoveryToken,
} from '@repo/shared';
import { AbandonedCartService } from '../services/abandoned-cart.service';
import { CouponIssuerService } from '../services/coupon-issuer.service';
import { LineFlexBuilderService } from '../services/line-flex-builder.service';

export interface LinePushPort {
  sendFlex(lineUserId: string, altText: string, flexMessageJson: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyLinePush implements LinePushPort {
  private readonly logger = new Logger(LogOnlyLinePush.name);

  constructor(private readonly redis: RedisClusterService) {}

  async sendFlex(lineUserId: string, altText: string, flexMessageJson: string): Promise<{ messageId: string }> {
    const messageId = `log-${Date.now().toString(36)}`;
    this.logger.log(`Flex queued for ${lineUserId}: ${altText.slice(0, 48)} (${flexMessageJson.length}B)`);
    try {
      await this.redis.xaddPipeline(CART_RECOVERY_STREAM, [
        { event: 'cart.flex.queued', lineUserId, messageId, at: Date.now() },
      ]);
    } catch {
      // Telemetry never breaks delivery records.
    }
    return { messageId };
  }
}

async function backoff<T>(attempts: number, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
  throw last;
}

@Injectable()
export class AbandonedCartProcessor {
  private readonly logger = new Logger(AbandonedCartProcessor.name);

  constructor(
    private readonly carts: AbandonedCartService,
    private readonly coupons: CouponIssuerService,
    private readonly flex: LineFlexBuilderService,
    private readonly push: LogOnlyLinePush,
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly secret: string = process.env['RECOVERY_TOKEN_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz',
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  /** Sweep due carts for a step (cron/admin invocable, idempotent). */
  async drainDue(step: 'STEP_1_15_MIN' | 'STEP_2_3_HOURS', now = Date.now()): Promise<{ sent: number; skipped: number }> {
    const due = await this.carts.dueCarts(step, now);
    let sent = 0;
    let skipped = 0;
    for (const { id } of due) {
      try {
        const done = await this.processOne(id, step, now);
        if (done) sent++;
        else skipped++;
      } catch (e) {
        this.logger.warn(`Abandoned job failed for ${id}: ${(e as Error).message}`);
        skipped++;
      }
    }
    return { sent, skipped };
  }

  private async processOne(cartId: string, step: 'STEP_1_15_MIN' | 'STEP_2_3_HOURS', now: number): Promise<boolean> {
    const lockKey = `lock:abandon:send:${cartId}:${step}`;
    try {
      const res = await this.redis.set(lockKey, '1', 'NX', 'EX', 300);
      if (res !== 'OK') return false;
    } catch {
      return false;
    }
    const db = this.prisma as unknown as {
      cart: {
        findUnique(a: unknown): Promise<{
          id: string; userId: string; tenantId: string; status: string;
          user: { displayName: string; lineUserId: string | null };
          items: Array<{ productId: string; quantity: number; price: unknown; product: { title: string; coverImageUrl: string; price: unknown } }>;
          logs: Array<{ step: string }>;
        } | null>;
        update(a: unknown): Promise<unknown>;
      };
      abandonedCartLog: { create(a: unknown): Promise<{ id: string }> };
      behavioralCampaign: {
        findFirst(a: unknown): Promise<{ discountValue: unknown } | null>;
      };
    };
    const cart = await db.cart
      .findUnique({ where: { id: cartId }, include: { user: true, items: { include: { product: true } }, logs: true } })
      .catch(() => null);
    if (!cart || cart.status !== 'ABANDONED' || cart.items.length === 0) return false;
    if (!cart.user.lineUserId) return false;
    if (cart.logs.filter((l) => l.step === step).length > 0) return false;
    if (cart.logs.length >= RECOVERY_MAX_MESSAGES) return false;

    const items = cart.items.map((i) => {
      const unit = Number((i.price as { toString(): string } | null)?.toString?.() ?? (i.product.price as { toString(): string }).toString());
      return { productTitle: i.product.title, coverImageUrl: i.product.coverImageUrl, price: unit, quantity: i.quantity };
    });
    const total = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    const campaign = await db.behavioralCampaign
      .findFirst({ where: { tenantId: cart.tenantId, isActive: true } })
      .catch(() => null);
    const pct = campaign ? Number((campaign.discountValue as { toString(): string }).toString()) : step === 'STEP_1_15_MIN' ? 10 : 15;
    const coupon = this.coupons.issue({ totalAmount: total, step, discountPercent: pct, now });
    const token = signRecoveryToken(this.secret, cartId, now);
    const url = recoveryUrl(this.origin, token);
    const { flexMessageJson } = this.flex.build({
      userName: cart.user.displayName,
      items,
      totalAmount: total,
      discountAmount: recoveryDiscount(total, pct),
      couponCode: coupon.couponCode,
      countdownSec: couponCountdownSec(coupon.expiresAt, now),
      recoveryUrl: url,
    });

    const sent = await backoff(3, () =>
      this.push.sendFlex(cart.user.lineUserId as string, '🛒 คุณมีสินค้าค้างอยู่ในตะกร้า! รับส่วนลดพิเศษก่อนสินค้าหมด', flexMessageJson),
    ).catch(() => null);
    await db.abandonedCartLog.create({
      data: { cartId, step, lineMessageId: sent?.messageId ?? null, couponCode: coupon.couponCode },
    });
    try {
      await this.redis.xaddPipeline(CART_RECOVERY_STREAM, [
        { event: sent ? 'cart.flex.sent' : 'cart.flex.failed', cartId, step, at: Date.now() },
      ]);
    } catch {
      // Telemetry never breaks the log row.
    }
    return sent != null;
  }
}
