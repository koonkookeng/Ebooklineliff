// SSOT Phase 096 §5.2 — Redis leaderboard (sorted sets, sub-ms reads)
// Canonical: apps/backend/src/modules/leaderboard/services/redis-leaderboard.service.ts
// - updateUserScore fans out to all timeframes via pipeline; reads ride
//   ZREVRANGE WITHSCORES (<1ms, BDD-3). Port-based for DB-free tests.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { leaderboardKey } from '@repo/shared';

export interface LeaderboardEntry {
  memberId: string;
  score: number;
  rank: number;
}

export interface SortedSetPort {
  zincrby(key: string, increment: number, member: string): Promise<unknown>;
  zrevrangeWithScores(key: string, start: number, stop: number): Promise<Array<{ member: string; score: number }>>;
}

const TIMEFRAMES = ['daily', 'weekly', 'monthly', 'all_time'];

@Injectable()
export class RedisLeaderboardService {
  constructor(private readonly zsets: SortedSetPort) {}

  async updateUserScore(args: { userId: string; addedPoints: number; tenantId?: string }): Promise<void> {
    for (const tf of TIMEFRAMES) {
      await this.zsets.zincrby(leaderboardKey('global', args.tenantId ?? 'global', tf), args.addedPoints, args.userId);
    }
  }

  async updateSquadScore(args: { squadId: string; addedPoints: number; tenantId?: string }): Promise<void> {
    for (const tf of TIMEFRAMES) {
      await this.zsets.zincrby(leaderboardKey('squad', args.tenantId ?? 'global', tf), args.addedPoints, args.squadId);
    }
  }

  async topRankings(args: { scope: string; tenantId?: string; timeframe: string; limit: number }): Promise<LeaderboardEntry[]> {
    const rows = await this.zsets.zrevrangeWithScores(
      leaderboardKey(args.scope, args.tenantId ?? 'global', args.timeframe),
      0,
      Math.max(0, args.limit - 1),
    );
    return rows.map((r, i) => ({ memberId: r.member, score: r.score, rank: i + 1 }));
  }
}
