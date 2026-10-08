// SSOT Phase 083 BDD-3 — Badge evaluation use-case (event-triggered unlocks)
// Canonical: apps/backend/src/modules/gamification/application/use-cases/evaluate-badges.use-case.ts
// - Triggered after check-ins, lesson completions and purchases: resolves
//   stats, evaluates seed rules, persists new unlocks + point rewards
//   (P2002-safe replay), emits the unlock stream for the Flex share card.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { GAMIFICATION_STREAM } from '@repo/shared';
import { BadgeEvaluatorService } from '../../domain/services/badge-evaluator.service';
import type { GamificationRepository } from '../../infrastructure/repositories/prisma-gamification.repository';
import type { StreakLockPort } from '../../infrastructure/redis/redis-streak-lock.service';

@Injectable()
export class EvaluateBadgesUseCase {
  constructor(
    private readonly repo: GamificationRepository,
    private readonly badges: BadgeEvaluatorService,
    private readonly locks: StreakLockPort,
  ) {}

  async execute(userId: string): Promise<Array<{ badgeId: string; badgeName: string; iconUrl: string }>> {
    const rules = await this.repo.ensureSeedBadges();
    const unlocked = await this.repo.unlockedBadgeIds(userId);
    const stats = await this.repo.userStats(userId);
    const earned = this.badges.evaluate(rules, stats, unlocked);
    if (earned.length === 0) return [];
    const granted = await this.repo.unlockBadges(userId, earned);
    for (const g of granted) {
      await this.locks.emit(GAMIFICATION_STREAM, {
        event: 'game.badge.unlocked',
        userId,
        badgeId: g.id,
        at: Date.now(),
      });
    }
    return granted.map((g) => ({ badgeId: g.id, badgeName: g.name, iconUrl: g.iconUrl }));
  }
}
