// SSOT Phase 088 — Loyalty points service (quote + debit primitives)
// Canonical: apps/backend/src/modules/promotion/services/points.service.ts
// - balance: User.rewardPoints (083 wallet, read-only reuse).
// - debitPoints: atomic decrement with cover guard (order-time primitive;
//   quote-time validation lives in the calculator).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { POINTS_MIN_REDEEM } from '@repo/shared';

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  async balance(userId: string): Promise<number> {
    const db = this.prisma as unknown as {
      user: { findUnique(a: unknown): Promise<{ rewardPoints: number } | null> };
    };
    const row = await db.user.findUnique({ where: { id: userId } }).catch(() => null);
    return row?.rewardPoints ?? 0;
  }

  async debitPoints(userId: string, points: number): Promise<number> {
    if (!(points >= POINTS_MIN_REDEEM)) throw new BadRequestException(`MINIMUM_POINTS_REQUIRED_${POINTS_MIN_REDEEM}`);
    const db = this.prisma as unknown as {
      user: {
        findUnique(a: unknown): Promise<{ rewardPoints: number } | null>;
        update(a: unknown): Promise<{ rewardPoints: number }>;
      };
    };
    const row = await db.user.findUnique({ where: { id: userId } }).catch(() => null);
    if (!row || row.rewardPoints < points) throw new BadRequestException('INSUFFICIENT_REWARD_POINTS');
    const updated = await db.user.update({
      where: { id: userId },
      data: { rewardPoints: { decrement: points } },
    });
    return updated.rewardPoints;
  }
}
