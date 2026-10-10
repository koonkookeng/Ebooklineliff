// SSOT Phase 117 Task 4 §5.2/BDD-1 — validate + reserve coupon use-case
// Canonical: apps/backend/src/modules/campaign/application/use-cases/validate-coupon.use-case.ts
// (legacy src/backend/modules/campaign/application/use-cases/validate-coupon.use-case.ts)
// - Flow (§5.2 + BDD-1 <50ms): Zod gate (uppercase) -> meta cache-first
//   (<5ms lane) -> entity gates (live/quota/user/min) -> calculator ->
//   15-min reservation hold (soft concurrency guard; the hard commit is the
//   DB conditional increment at checkout) -> response + stream + elapsedMs.
// - One-time claims enforced exactly via UserCouponClaim (stronger than the
//   spec's Bloom filter — same latency path via the Redis pre-guard).
// - Zero new deps.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  COUPON_VALIDATE_BUDGET_MS,
  ValidateCouponInputSchema,
  couponMetaKey,
  couponQuotaKey,
  couponReservationKey,
  couponValidateTryKey,
  couponUserKey,
  type CouponValidationResponse,
} from '@repo/shared';
import { DiscountCalculatorService } from '../services/discount-calculator.service';
import { PrismaCouponRepository } from '../../infrastructure/persistence/prisma-coupon.repository';
import { CouponCacheRepository } from '../../infrastructure/redis/coupon-cache.repository';
import { isCouponLive, quotaLeft, quotaOf, type CouponRow117 } from '../../domain/entities/coupon.entity';
import { combineDiscounts, type DiscountLine } from '../../domain/value-objects/discount-result.vo';

@Injectable()
export class ValidateCouponUseCase {
  private readonly logger = new Logger(ValidateCouponUseCase.name);

  constructor(
    private readonly calculator: DiscountCalculatorService,
    private readonly store: PrismaCouponRepository,
    private readonly cache: CouponCacheRepository,
  ) {}

  async execute(input: unknown, userId: string): Promise<CouponValidationResponse & { reservationToken: string; elapsedMs: number }> {
    const startedAt = Date.now();
    const parsed = ValidateCouponInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid coupon payload');
    const { couponCode, cartItems, shippingFee } = parsed.data;
    if (!userId) throw new BadRequestException('Missing authentication');

    if (await this.cache.tryRateLimited(couponValidateTryKey(userId))) {
      throw new BadRequestException('กดตรวจสอบถี่เกินไป กรุณารอสักครู่');
    }

    let meta = await this.cache.metaGet<CouponRow117 & Record<string, unknown>>(couponMetaKey(couponCode));
    if (!meta) {
      meta = (await this.store.findByCode(couponCode).catch(() => null)) as (CouponRow117 & Record<string, unknown>) | null;
      if (!meta) throw new BadRequestException('ไม่พบรหัสคูปองนี้ในระบบ');
      await this.cache.metaSet(couponMetaKey(couponCode), meta);
    }
    const row = meta as unknown as CouponRow117 & {
      couponType: string; discountValue: unknown; maxDiscountAmount?: unknown; scope?: string | null;
    };
    if (!isCouponLive(row, Date.now())) {
      throw new BadRequestException('คูปองนี้หมดอายุหรือยังไม่เปิดใช้งาน');
    }
    if (quotaLeft(row) <= 0) {
      throw new BadRequestException('โค้ดส่วนลดนี้ถูกใช้งานเต็มจำนวนแล้ว');
    }
    const quota = quotaOf(row);
    const [claimed, mirrorLeft] = await Promise.all([
      this.store.userClaimCount(userId, row.id),
      this.mirrorQuota(couponQuotaKey(row.id), quota.limit - quota.used),
    ]);
    if (claimed >= quota.perUser) {
      throw new BadRequestException('ท่านใช้สิทธิ์คูปองนี้ครบตามจำนวนที่กำหนดแล้ว');
    }
    if (mirrorLeft === 0) {
      throw new BadRequestException('โค้ดส่วนลดนี้ถูกใช้งานเต็มจำนวนแล้ว');
    }

    const targets = await this.store.targetProductIds(row.id).catch(() => new Set<string>());
    const line: DiscountLine = this.calculator.calculate(
      {
        ...row,
        couponType: row.couponType as DiscountLine['couponType'],
        discountValue: Number(row.discountValue ?? 0),
        maxDiscountAmount: row.maxDiscountAmount === null || row.maxDiscountAmount === undefined ? null : Number(row.maxDiscountAmount),
      },
      { items: cartItems, shippingFee },
      targets,
    );

    const gross = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const combined = combineDiscounts(gross, shippingFee, [line]);
    // Soft hold: display-level oversell guard only — quota is NOT debited
    // here; the hard commit is the conditional DB increment at checkout.
    const reservationToken = randomUUID();
    await this.cache.reserveHold(couponReservationKey(userId, row.id), reservationToken);

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > COUPON_VALIDATE_BUDGET_MS) {
      this.logger.warn(`Validate SLA breach for ${couponCode}: ${elapsedMs}ms`);
    }
    await this.cache.publish('coupon.validated', {
      couponId: row.id, userId, discount: combined.totalDiscountAmount, elapsedMs,
    });
    return {
      isValid: true,
      message: 'ประยุกต์ใช้ส่วนลดเรียบร้อยแล้ว',
      totalDiscountAmount: combined.totalDiscountAmount,
      netAmount: combined.netAmount,
      breakdown: [
        {
          couponCode: line.couponCode,
          couponType: line.couponType,
          platformDiscount: line.platformDiscount,
          sellerDiscount: line.sellerDiscount,
          shippingDiscount: line.shippingDiscount,
          appliedItemIds: line.appliedItemIds,
        },
      ],
      reservationToken,
      elapsedMs,
    };
  }

  /** Redis quota mirror (fast path; seeds from DB on miss). */
  private async mirrorQuota(key: string, dbLeft: number): Promise<number> {
    const left = await this.cache.quotaDecrement(key, 0).catch(() => -1);
    if (left >= 0) return left;
    await this.cache.quotaSeed(key, dbLeft);
    return dbLeft;
  }
}
