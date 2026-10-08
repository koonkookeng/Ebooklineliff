// SSOT Phase 083 BDD-4/Task 5 — Atomic reward redemption use-case
// Canonical: apps/backend/src/modules/gamification/application/use-cases/redeem-reward.use-case.ts
// - Flow (§5.2 verbatim): Zod gate -> velocity tripwire (>5/min → freeze
//   signal + 429-style reject) -> ONE $transaction: cover check, points +
//   stock decrement, redemption row, entitlement upsert for EBOOK/COURSE
//   rewards (Gate 7, <500ms) -> stream event (Gate 8).
// - Error taxonomy maps to 400 TH messages (repository throws codes).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { GAMIFICATION_STREAM, RewardRedemptionInputSchema, redemptionCode } from '@repo/shared';
import { assertRedemptionCover } from '../../domain/entities/badge.entity';
import type { GamificationRepository } from '../../infrastructure/repositories/prisma-gamification.repository';
import type { StreakLockPort } from '../../infrastructure/redis/redis-streak-lock.service';

export interface RedeemTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

const CODE_TO_MESSAGE: Record<string, string> = {
  REWARD_UNAVAILABLE: 'สินค้าของรางวัลไม่พร้อมใช้งาน',
  REWARD_OUT_OF_STOCK: 'ของรางวัลนี้หมดแล้ว',
  REWARD_INSUFFICIENT_POINTS: 'คะแนนสะสมของคุณไม่เพียงพอสำหรับการแลก',
};

@Injectable()
export class RedeemRewardUseCase {
  constructor(
    private readonly repo: GamificationRepository,
    private readonly locks: StreakLockPort,
    private readonly tx: RedeemTx,
  ) {}

  async execute(userId: string, body: unknown): Promise<{
    success: boolean;
    redemptionCode: string;
    remainingPoints: number;
    entitlementGranted: boolean;
  }> {
    const parsed = RewardRedemptionInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid redemption request');

    const hits = await this.locks.bumpRedeem(userId);
    if (hits > this.locks.redeemLimit()) {
      await this.locks.emit(GAMIFICATION_STREAM, {
        event: 'game.redeem.velocity-freeze',
        userId,
        hits,
        at: Date.now(),
      });
      throw new ConflictException('Too many redemptions — account temporarily frozen for review');
    }

    const t0 = Date.now();
    const code = redemptionCode();
    const out = await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      const wallet = await repo.walletPoints(userId);
      const catalog = await repo.catalog();
      const item = catalog.find((c) => c.id === parsed.data.rewardItemId);
      if (!item || !item.isPublished) throw new BadRequestException(CODE_TO_MESSAGE['REWARD_UNAVAILABLE']);
      if (item.stockQty <= 0) throw new BadRequestException(CODE_TO_MESSAGE['REWARD_OUT_OF_STOCK']);
      assertRedemptionCover(wallet, item.pointsRequired);
      return repo.redeemAtomic({
        userId,
        rewardItemId: parsed.data.rewardItemId,
        redemptionCode: code,
      });
    });

    await this.locks.emit(GAMIFICATION_STREAM, {
      event: 'game.redeem.completed',
      userId,
      rewardItemId: parsed.data.rewardItemId,
      tookMs: Date.now() - t0,
      at: Date.now(),
    });
    return {
      success: true,
      redemptionCode: code,
      remainingPoints: out.remainingPoints,
      entitlementGranted: out.entitlementGranted,
    };
  }
}
