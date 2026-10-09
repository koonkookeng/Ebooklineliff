// SSOT Phase 096 BDD-3 — Leaderboard REST (proxy surface for LIFF)
// Canonical: apps/backend/src/modules/leaderboard/leaderboard.controller.ts
// - GET board (JWT; ZREVRANGE slices). Zero new deps.
import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { LeaderboardScopeEnum, LeaderboardTimeframeEnum } from '@repo/shared';
import { RedisLeaderboardService } from './services/redis-leaderboard.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string | null {
  return (req['user'] as { id?: string } | undefined)?.id ?? null;
}

@Controller('api/v1/leaderboard')
@UseGuards(JwtAuthGuard, TenantGuard)
export class LeaderboardController {
  constructor(private readonly board: RedisLeaderboardService) {}

  @Get()
  async getBoard(
    @Req() req: LooseReq,
    @Query('scope') scope: string | undefined,
    @Query('timeframe') timeframe: string | undefined,
    @Query('limit') limitRaw: string | undefined,
  ) {
    const scopeParsed = LeaderboardScopeEnum.safeParse(scope ?? 'GLOBAL');
    const tfParsed = LeaderboardTimeframeEnum.safeParse(timeframe ?? 'WEEKLY');
    if (!scopeParsed.success || !tfParsed.success) throw new BadRequestException('Invalid leaderboard slice');
    const userId = actorOf(req);
    const rows = await this.board.topRankings({
      scope: scopeParsed.data,
      timeframe: tfParsed.data,
      limit: Math.min(50, Math.max(1, Number(limitRaw) || 50)),
    });
    return rows.map((r) => ({
      rank: r.rank,
      entityId: r.memberId,
      displayName: r.memberId.slice(0, 8),
      avatarUrl: null,
      score: r.score,
      isCurrentUser: userId != null && r.memberId === userId,
    }));
  }
}
