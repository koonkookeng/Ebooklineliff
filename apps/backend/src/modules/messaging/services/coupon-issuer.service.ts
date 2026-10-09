// SSOT Phase 084 Task 5 — Dynamic recovery coupon issuer (codeless coupons)
// Canonical: apps/backend/src/modules/messaging/services/coupon-issuer.service.ts
// - Coupon truth = (AbandonedCartLog.couponCode + BehavioralCampaign rule):
//   no parallel coupon table (088/117 own coupon design — documented).
//   Codes are RECOVER-XXXXX, step-bound, 2h TTL (§5.2).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  RECOVERY_COUPON_TTL_SEC,
  RECOVERY_STEP1_PCT,
  RECOVERY_STEP2_PCT,
  recoveryCouponCode,
  recoveryDiscount,
} from '@repo/shared';

export interface IssuedCoupon {
  couponCode: string;
  discountPercent: number;
  discountAmount: number;
  expiresAt: number;
}

@Injectable()
export class CouponIssuerService {
  issue(args: {
    totalAmount: number;
    step: 'STEP_1_15_MIN' | 'STEP_2_3_HOURS';
    discountPercent?: number;
    now?: number;
  }): IssuedCoupon {
    const now = args.now ?? Date.now();
    const pct = args.discountPercent ?? (args.step === 'STEP_1_15_MIN' ? RECOVERY_STEP1_PCT : RECOVERY_STEP2_PCT);
    return {
      couponCode: recoveryCouponCode(),
      discountPercent: pct,
      discountAmount: recoveryDiscount(args.totalAmount, pct),
      expiresAt: now + RECOVERY_COUPON_TTL_SEC * 1000,
    };
  }

  /** Coupon window check (2h from the log's sentAt). */
  isLive(sentAt: number, now = Date.now()): boolean {
    return now - sentAt < RECOVERY_COUPON_TTL_SEC * 1000;
  }
}
