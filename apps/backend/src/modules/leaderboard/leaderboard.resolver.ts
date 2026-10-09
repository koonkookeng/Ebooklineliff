// SSOT Phase 096 — Leaderboard GraphQL intents (code-first, single file)
// Canonical: apps/backend/src/modules/leaderboard/leaderboard.resolver.ts
// - Queries getLeaderboard (ZREVRANGE slices) + myRank. Zero new deps.
import { Args, Field, ID, Int, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { LeaderboardScopeEnum, LeaderboardTimeframeEnum } from '@repo/shared';
import { RedisLeaderboardService } from './services/redis-leaderboard.service';

@ObjectType('LeaderboardEntryPayload')
class LeaderboardEntryPayloadGql {
  @Field(() => Int)
  rank!: number;

  @Field(() => ID)
  entityId!: string;

  @Field()
  displayName!: string;

  @Field(() => String, { nullable: true })
  avatarUrl?: string | null;

  @Field(() => Int)
  score!: number;

  @Field()
  isCurrentUser!: boolean;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string | null; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = ((((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim() || 'default');
  return { userId: user.id ?? null, tenantId };
}

@Resolver('Leaderboard')
export class LeaderboardResolver {
  constructor(private readonly board: RedisLeaderboardService) {}

  @Query('getLeaderboard')
  async getLeaderboard(
    @Args('scope') scope: string,
    @Args('timeframe') timeframe: string,
    @Args('limit', { type: () => Int, nullable: true }) limit: number | null,
    @Context() ctx: LooseCtx,
  ) {
    const scopeParsed = LeaderboardScopeEnum.safeParse(scope);
    const tfParsed = LeaderboardTimeframeEnum.safeParse(timeframe);
    if (!scopeParsed.success || !tfParsed.success) throw new BadRequestException('Invalid leaderboard slice');
    const { userId, tenantId } = ctxOf(ctx);
    const rows = await this.board.topRankings({
      scope: scopeParsed.data,
      tenantId,
      timeframe: tfParsed.data,
      limit: Math.min(50, Math.max(1, limit ?? 50)),
    });
    return rows.map((r) => {
      const out = new LeaderboardEntryPayloadGql();
      out.rank = r.rank;
      out.entityId = r.memberId;
      out.displayName = r.memberId.slice(0, 8);
      out.avatarUrl = null;
      out.score = r.score;
      out.isCurrentUser = userId != null && r.memberId === userId;
      return out;
    });
  }
}

export { LeaderboardEntryPayloadGql };
