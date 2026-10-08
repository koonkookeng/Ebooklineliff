// SSOT Phase 083 Task 4 — Nightly streak maintenance (freeze sweep, cron-ready)
// Canonical: apps/backend/src/modules/gamification/application/streak-maintenance.service.ts
// (ADDITIVE to the §5.1 tree: the tree lists no maintenance file, but BDD-2
// needs a home — this service is it. Wire your 00:00:01 UTC scheduler here;
// no scheduler dep is added per the zero-dep rule.)
// - For every stale streak (last check-in before yesterday, streak > 0):
//   freeze owned → consume 1, streak kept (+Flex notify intent via stream);
//   no freeze → reset to 0.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { GAMIFICATION_STREAM, utcDayKey } from '@repo/shared';
import type { GamificationRepository } from '../infrastructure/repositories/prisma-gamification.repository';
import type { StreakLockPort } from '../infrastructure/redis/redis-streak-lock.service';

@Injectable()
export class StreakMaintenanceService {
  constructor(
    private readonly repo: GamificationRepository,
    private readonly locks: StreakLockPort,
  ) {}

  async sweep(now = Date.now()): Promise<{ protected: number; reset: number }> {
    const yesterdayKey = utcDayKey(now - 86_400_000);
    const stale = await this.repo.listStaleStreaks(yesterdayKey);
    let kept = 0;
    let reset = 0;
    for (const s of stale) {
      if (s.freezeCount > 0 && s.currentStreak > 0) {
        await this.repo.consumeFreeze(s.userId);
        await this.locks.emit(GAMIFICATION_STREAM, {
          event: 'game.streak.freeze-protected',
          userId: s.userId,
          streak: s.currentStreak,
          at: Date.now(),
        });
        kept++;
      } else if (s.currentStreak > 0) {
        await this.repo.resetStreak(s.userId);
        reset++;
      }
    }
    return { protected: kept, reset };
  }
}
