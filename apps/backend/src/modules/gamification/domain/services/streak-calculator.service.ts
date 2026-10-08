// SSOT Phase 083 §5.1 — Streak calculator (pure day math)
// Canonical: apps/backend/src/modules/gamification/domain/services/streak-calculator.service.ts
// - Thin injectable over the contract pures (multiplier/points/next-streak).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { checkinPoints, nextMilestoneDays, nextStreak, streakMultiplier } from '@repo/shared';

@Injectable()
export class StreakCalculatorService {
  multiplier(streakDays: number): number {
    return streakMultiplier(streakDays);
  }

  pointsFor(streakDays: number): number {
    return checkinPoints(streakDays);
  }

  next(currentStreak: number, gapDays: number, freezeCount: number): { streak: number; freezeUsed: boolean } {
    return nextStreak({ currentStreak, gapDays, freezeCount });
  }

  milestone(streakDays: number): number {
    return nextMilestoneDays(streakDays);
  }
}
