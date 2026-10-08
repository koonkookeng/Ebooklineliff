// SSOT Phase 083 BDD-1/Task 3 — Daily check-in use-case (locked, atomic)
// Canonical: apps/backend/src/modules/gamification/application/use-cases/daily-checkin.use-case.ts
// - Flow (§5.2 verbatim): Redis mutex (409 on race) -> server-UTC today ->
//   duplicate guard (400, @@unique second line) -> streak row (create on
//   first run) -> continue / freeze-consume / reset math -> multiplier ->
//   ONE $transaction: checkin row + streak update + wallet points (Gate 7) ->
//   badge evaluation (BDD-3, same flow) -> cache invalidate + stream (Gate 8).
// - Freeze auto-consume mirrors BDD-2 (inline; the nightly maintenance
//   sweep replays it for missed days — Task 4 lives in the same file group
//   via processStreakMaintenance on the maintenance service seam below).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GAMIFICATION_STREAM,
  checkinPoints,
  dayGap,
  nextMilestoneDays,
  nextStreak,
  streakMultiplier,
  utcDayKey,
} from '@repo/shared';
import { assertCheckinLock, assertNotCheckedInToday } from '../../domain/entities/streak.entity';
import { BadgeEvaluatorService } from '../../domain/services/badge-evaluator.service';
import type { GamificationRepository } from '../../infrastructure/repositories/prisma-gamification.repository';
import type { StreakLockPort } from '../../infrastructure/redis/redis-streak-lock.service';

export interface CheckinTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class DailyCheckinUseCase {
  constructor(
    private readonly repo: GamificationRepository,
    private readonly locks: StreakLockPort,
    private readonly tx: CheckinTx,
    private readonly badges: BadgeEvaluatorService,
  ) {}

  async execute(userId: string, now = Date.now()): Promise<{
    success: boolean;
    message: string;
    currentStreak: number;
    pointsEarned: number;
    bonusMultiplier: number;
    nextMilestoneDays: number;
    badgeUnlocked: { badgeId: string; badgeName: string; iconUrl: string } | null;
  }> {
    const locked = await this.locks.acquireCheckin(userId);
    assertCheckinLock(locked);
    try {
      const todayKey = utcDayKey(now);
      const today = new Date(`${todayKey}T00:00:00Z`);
      const row = await this.repo.ensureStreak(userId);
      const lastKey = row.lastCheckinDate ? utcDayKey(new Date(row.lastCheckinDate).getTime()) : null;
      const gap = dayGap(lastKey, todayKey);
      assertNotCheckedInToday(gap);

      const { streak, freezeUsed } = nextStreak({
        currentStreak: row.currentStreak,
        gapDays: gap === Number.POSITIVE_INFINITY ? -1 : gap,
        freezeCount: row.streakFreezeCount,
      });
      const multiplier = streakMultiplier(streak);
      const points = checkinPoints(streak);

      const out = await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        if (await repo.hasCheckin(userId, today)) {
          throw new BadRequestException('คุณได้ทำการเช็กอินประจำวันเรียบร้อยแล้ว');
        }
        await repo.recordCheckin({
          userId,
          day: today,
          streak,
          points,
          multiplier,
          freezeUsed,
        });
        const saved = await repo.saveStreak(userId, {
          currentStreak: streak,
          longestStreak: Math.max(streak, row.longestStreak),
          lastCheckinDate: today,
          freezeUsed,
        });
        await repo.addPoints(userId, points);
        // BDD-3: evaluate badges in the same flow (stats after this check-in).
        const rules = await repo.ensureSeedBadges();
        const unlocked = await repo.unlockedBadgeIds(userId);
        const stats = await repo.userStats(userId);
        const earned = this.badges.evaluate(rules, { ...stats, streakDays: streak }, unlocked);
        const granted = await repo.unlockBadges(userId, earned);
        return { saved, granted };
      });

      await this.locks.emit(GAMIFICATION_STREAM, {
        event: 'game.checkin.completed',
        userId,
        streak,
        points,
        freezeUsed: freezeUsed ? 1 : 0,
        at: Date.now(),
      });

      const first = out.granted[0];
      const badgeUnlocked = first && first.iconUrl
        ? { badgeId: first.id, badgeName: first.name, iconUrl: first.iconUrl }
        : null;
      return {
        success: true,
        message: `เช็กอินสำเร็จ! คุณได้รับ ${points} แต้ม (Streak ${streak} วัน)`,
        currentStreak: streak,
        pointsEarned: points,
        bonusMultiplier: multiplier,
        nextMilestoneDays: nextMilestoneDays(streak),
        badgeUnlocked,
      };
    } finally {
      await this.locks.releaseCheckin(userId);
    }
  }
}
