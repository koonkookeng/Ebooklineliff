// SSOT Phase 117 BDD-2 — multi-coupon stack service (matrix + combine)
// Canonical: apps/backend/src/modules/campaign/application/services/coupon-stack.service.ts
// - Shared by the GQL applyCouponStack intent and the REST stack lane (no
//   dual implementation): validate each code (1–5) -> compatibility matrix
//   fail-fast -> proportional combine (Net ≥ 0).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { couponLane, stackingCompatible, type CouponCartItem, type StackLane } from '@repo/shared';
import { ValidateCouponUseCase } from '../use-cases/validate-coupon.use-case';
import { PrismaCouponRepository } from '../../infrastructure/persistence/prisma-coupon.repository';
import { combineDiscounts, type DiscountLine } from '../../domain/value-objects/discount-result.vo';

@Injectable()
export class CouponStackService {
  constructor(
    private readonly validate: ValidateCouponUseCase,
    private readonly store: PrismaCouponRepository,
  ) {}

  async applyStack(userId: string, args: { codes: string[]; cartItems: CouponCartItem[]; shippingFee?: number }): Promise<{
    isValid: boolean; message: string; totalDiscountAmount: number; netAmount: number; breakdown: DiscountLine[];
  }> {
    const { codes, cartItems } = args;
    const ship = args.shippingFee ?? 0;
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > 5) {
      throw new BadRequestException('Provide 1-5 coupon codes');
    }
    const lines: DiscountLine[] = [];
    const appliedLanes: StackLane[] = [];
    for (const code of codes) {
      const verdict = await this.validate.execute({ couponCode: code, cartItems, shippingFee: ship }, userId);
      const first = verdict.breakdown[0];
      if (!first) throw new BadRequestException(`Coupon ${code} produced no discount`);
      const lane = couponLane(first.couponType);
      const row = (await this.store.findByCode(code).catch(() => null)) as {
        canStackWithPlatform?: boolean | null; canStackWithStore?: boolean | null; canStackWithShipping?: boolean | null;
      } | null;
      if (!stackingCompatible({
        lane,
        canStackWithPlatform: row?.canStackWithPlatform ?? true,
        canStackWithStore: row?.canStackWithStore ?? false,
        canStackWithShipping: row?.canStackWithShipping ?? true,
      }, appliedLanes)) {
        throw new BadRequestException(`Coupon ${code} cannot stack with already applied coupons`);
      }
      appliedLanes.push(lane);
      lines.push({ ...first, lane });
    }
    const gross = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const combined = combineDiscounts(gross, ship, lines);
    return {
      isValid: true,
      message: `ประยุกต์ใช้ ${lines.length} คูปองเรียบร้อยแล้ว`,
      totalDiscountAmount: combined.totalDiscountAmount,
      netAmount: combined.netAmount,
      breakdown: lines,
    };
  }
}
