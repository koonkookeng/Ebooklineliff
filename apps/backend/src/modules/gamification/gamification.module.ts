// SSOT Phase 083 §5.1 + Phase 096 — Gamification module wiring
// Canonical: apps/backend/src/modules/gamification/gamification.module.ts
// (legacy class name GamificationModuleModule renamed — no importers.
// Phase 096 landed: services/point-engine + services/anti-cheat +
// application/subscribers + events/ are implemented below; 083 streak/badge
// wiring untouched.)
// - Streak/badge domain -> structural repo + Redis locks -> checkin/redeem/
//   evaluate/maintenance -> REST + GQL. Point claims ride Prisma $transaction
//   (Gate 7) with Redis leaderboard fan-out (Gate 8).
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
import { SquadPointsResolver } from './presentation/graphql/squad-points.resolver';
import { PointClaimController } from './presentation/rest/point-claim.controller';
import { AntiCheatGuard } from './services/anti-cheat.guard';
import { PointEngineService } from './services/point-engine.service';
import { StudyActivityListener } from './events/study-activity.listener';
import { LearningEventSubscriber } from './application/subscribers/learning-event.subscriber';
import { PrismaSquadRepository } from '../squad/infrastructure/persistence/prisma-squad.repository';
import { RedisLeaderboardService } from '../leaderboard/services/redis-leaderboard.service';
import { SquadModule } from '../squad/squad.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

@Module({
  imports: [SquadModule, LeaderboardModule],
  controllers: [GamificationController, PointClaimController],
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
    AntiCheatGuard,
    {
      provide: PointEngineService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        squads: PrismaSquadRepository,
        board: RedisLeaderboardService,
      ) =>
        new PointEngineService(
          {
            recordTransaction: async (tx: unknown, args) => {
              const db = (tx as Db)['pointTransaction'];
              await db.create({ data: { ...args } });
            },
            incrementUserPoints: async (tx: unknown, userId: string, points: number) => {
              const db = (tx as Db)['user'];
              const row = (await db.update({
                where: { id: userId },
                data: { rewardPoints: { increment: points } },
                select: { rewardPoints: true },
              })) as unknown as { rewardPoints: number };
              return row.rewardPoints;
            },
            incrementSquadPoints: async (tx: unknown, squadId: string, userId: string, points: number) => {
              const repo = squads.withTx ? squads.withTx(tx) : squads;
              await repo.addSquadPoints(squadId, points);
              await repo.addMemberPoints(squadId, userId, points);
            },
            recentClaimCount: async (userId: string, windowSec: number) => {
              const db = (prisma as unknown as Db)['pointTransaction'];
              return Number(
                await db.count({
                  where: { userId, createdAt: { gte: new Date(Date.now() - windowSec * 1000) } },
                }),
              );
            },
            markNonceUsed: async (nonce: string, ttlSec: number) => {
              const res = await redis.set(`nonce:claim:${nonce}`, '1', 'EX', ttlSec, 'NX').catch(() => null);
              return res === 'OK';
            },
            applyChallengeProgress: async (tx: unknown, squadId: string, points: number) => {
              const db = (tx as Db)['squadChallenge'];
              const open = (await db.findMany({
                where: { squadId, isCompleted: false, endDate: { gt: new Date() } },
                orderBy: { endDate: 'asc' },
                take: 5,
              })) as unknown as Array<{ id: string; targetPoints: number; currentPoints: number; rewardPoints: number }>;
              let bonus = 0;
              let completed = false;
              for (const ch of open) {
                const next = ch.currentPoints + points;
                if (next >= ch.targetPoints && !completed) {
                  await db.update({ where: { id: ch.id }, data: { currentPoints: next, isCompleted: true } });
                  bonus += ch.rewardPoints;
                  completed = true;
                } else {
                  await db.update({ where: { id: ch.id }, data: { currentPoints: next } });
                }
              }
              return { completed, bonus };
            },
          },
          board,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [PrismaService, RedisClusterService, PrismaSquadRepository, RedisLeaderboardService],
    },
    {
      provide: StudyActivityListener,
      useFactory: (points: PointEngineService) => new StudyActivityListener(points),
      inject: [PointEngineService],
    },
    {
      provide: LearningEventSubscriber,
      useFactory: (listener: StudyActivityListener) => new LearningEventSubscriber(listener),
      inject: [StudyActivityListener],
    },
    {
      provide: SquadPointsResolver,
      useFactory: (points: PointEngineService, squads: PrismaSquadRepository) =>
        new SquadPointsResolver(points, squads),
      inject: [PointEngineService, PrismaSquadRepository],
    },
  ],
  exports: [DailyCheckinUseCase, RedeemRewardUseCase, EvaluateBadgesUseCase, StreakMaintenanceService, PrismaGamificationRepository, PointEngineService, StudyActivityListener, LearningEventSubscriber],
})
export class GamificationModule {}
