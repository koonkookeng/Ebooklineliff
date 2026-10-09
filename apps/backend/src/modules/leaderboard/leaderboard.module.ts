// SSOT Phase 096 — Leaderboard module wiring
// Canonical: apps/backend/src/modules/leaderboard/leaderboard.module.ts
// - Sorted-set service (Redis additives) -> GQL. Zero new deps.
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { RedisLeaderboardService } from './services/redis-leaderboard.service';
import { LeaderboardResolver } from './leaderboard.resolver';
import { LeaderboardController } from './leaderboard.controller';

@Module({
  controllers: [LeaderboardController],
  providers: [
    {
      provide: RedisLeaderboardService,
      useFactory: (redis: RedisClusterService) =>
        new RedisLeaderboardService({
          zincrby: (key: string, increment: number, member: string) => redis.zincrby(key, increment, member),
          zrevrangeWithScores: (key: string, start: number, stop: number) =>
            redis.zrevrangeWithScores(key, start, stop),
        }),
      inject: [RedisClusterService],
    },
    {
      provide: LeaderboardResolver,
      useFactory: (board: RedisLeaderboardService) => new LeaderboardResolver(board),
      inject: [RedisLeaderboardService],
    },
  ],
  exports: [RedisLeaderboardService],
})
export class LeaderboardModule {}
