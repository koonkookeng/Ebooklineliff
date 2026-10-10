// SSOT Phase 117 Task 4 — claim-to-wallet + flash-sale lock use-cases
// Canonical: apps/backend/src/modules/campaign/application/use-cases/claim-coupon.use-case.ts
// (legacy src/backend/modules/campaign/application/use-cases/claim-coupon.use-case.ts)
// - Claim: Zod gate -> live + global-quota gates -> exact one-time ledger
//   (@@unique → already-claimed) -> per-user limit -> stream. Claim ≠ use:
//   redemption commits quota at checkout (commitQuota117).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { ClaimCouponInputSchema, couponUserKey } from '@repo/shared';
import { PrismaCouponRepository } from '../../infrastructure/persistence/prisma-coupon.repository';
import { CouponCacheRepository } from '../../infrastructure/redis/coupon-cache.repository';
import { isCouponLive, quotaLeft, quotaOf, type CouponRow117 } from '../../domain/entities/coupon.entity';

@Injectable()
export class ClaimCouponUseCase {
  constructor(
    private readonly store: PrismaCouponRepository,
    private readonly cache: CouponCacheRepository,
  ) {}

  async execute(input: unknown, userId: string): Promise<{ claimId: string; couponCode: string }> {
    const parsed = ClaimCouponInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid claim payload');
    if (!userId) throw new BadRequestException('Missing authentication');
    const { couponCode } = parsed.data;

    const row = (await this.store.findByCode(couponCode).catch(() => null)) as CouponRow117 | null;
    if (!row) throw new BadRequestException('ไม่พบรหัสคูปองนี้ในระบบ');
    if (!isCouponLive(row, Date.now())) {
      throw new BadRequestException('คูปองนี้หมดอายุหรือยังไม่เปิดใช้งาน');
    }
    if (quotaLeft(row) <= 0) {
      throw new BadRequestException('โค้ดส่วนลดนี้ถูกใช้งานเต็มจำนวนแล้ว');
    }
    // Fast pre-guard; the @@unique ledger is canonical.
    await this.cache.claimGuard(couponUserKey(userId, row.id));
    const created = await this.store.claimCoupon(userId, row.id);
    if (!created) throw new BadRequestException('ท่านเก็บคูปองนี้ไปแล้ว');
    if ((await this.store.userClaimCount(userId, row.id).catch(() => 1)) > quotaOf(row).perUser) {
      throw new BadRequestException('ท่านใช้สิทธิ์คูปองนี้ครบตามจำนวนที่กำหนดแล้ว');
    }
    await this.cache.publish('coupon.claimed', { couponId: row.id, userId });
    return { claimId: created.id, couponCode: row.code };
  }
}
