// SSOT Phase 083 §5.1 — Gamification module wiring (096 files untouched)
// Canonical: apps/backend/src/modules/gamification/gamification.module.ts
// (legacy class name GamificationModuleModule renamed — no importers.
// NOTE: application/subscribers, events/, services/point-engine and
// services/anti-cheat stay 096-owned scaffolds — asserted in 083 tests.)
// - Streak/badge domain -> structural repo + Redis locks -> checkin/redeem/
//   evaluate/maintenance -> REST + GQL. Entitlement writes ride the atomic
//   redeem txn (shared-module reuse, no duplication).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaGamificationRepository } from './infrastructure/repositories/prisma-gamification.repository';
import { RedisStreakLockService } from './infrastructure/redis/redis-streak-lock.service';
import { StreakCalculatorService } from './domain/services/streak-calculator.service';
import { BadgeEvaluatorService } from './domain/services/badge-evaluator.service';
import { DailyCheckinUseCase } from './application/use-cases/daily-checkin.use-case';
import { RedeemRewardUseCase } from './application/use-cases/redeem-reward.use-case';
import { EvaluateBadgesUseCase } from './application/use-cases/evaluate-badges.use-case';
import { StreakMaintenanceService } from './application/streak-maintenance.service';
import { GamificationResolver } from './presentation/graphql/gamification.resolver';
import { GamificationController } from './presentation/rest/gamification.controller';

@Module({
  controllers: [GamificationController],
  providers: [
    StreakCalculatorService,
    BadgeEvaluatorService,
    PrismaGamificationRepository,
    RedisStreakLockService,
    {
      provide: DailyCheckinUseCase,
      useFactory: (
        repo: PrismaGamificationRepository,
        locks: RedisStreakLockService,
        prisma: PrismaService,
        badges: BadgeEvaluatorService,
      ) =>
        new DailyCheckinUseCase(repo, locks, {
          run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)),
        }, badges),
      inject: [PrismaGamificationRepository, RedisStreakLockService, PrismaService, BadgeEvaluatorService],
    },
    {
      provide: RedeemRewardUseCase,
      useFactory: (
        repo: PrismaGamificationRepository,
        locks: RedisStreakLockService,
        prisma: PrismaService,
      ) =>
        new RedeemRewardUseCase(repo, locks, {
          run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)),
        }),
      inject: [PrismaGamificationRepository, RedisStreakLockService, PrismaService],
    },
    {
      provide: EvaluateBadgesUseCase,
      useFactory: (repo: PrismaGamificationRepository, badges: BadgeEvaluatorService, locks: RedisStreakLockService) =>
        new EvaluateBadgesUseCase(repo, badges, locks),
      inject: [PrismaGamificationRepository, BadgeEvaluatorService, RedisStreakLockService],
    },
    {
      provide: StreakMaintenanceService,
      useFactory: (repo: PrismaGamificationRepository, locks: RedisStreakLockService) =>
        new StreakMaintenanceService(repo, locks),
      inject: [PrismaGamificationRepository, RedisStreakLockService],
    },
    {
      provide: GamificationResolver,
      useFactory: (
        checkin: DailyCheckinUseCase,
        redeem: RedeemRewardUseCase,
        repo: PrismaGamificationRepository,
      ) => new GamificationResolver(checkin, redeem, repo),
      inject: [DailyCheckinUseCase, RedeemRewardUseCase, PrismaGamificationRepository],
    },
  ],
  exports: [DailyCheckinUseCase, RedeemRewardUseCase, EvaluateBadgesUseCase, StreakMaintenanceService, PrismaGamificationRepository],
})
export class GamificationModule {}
