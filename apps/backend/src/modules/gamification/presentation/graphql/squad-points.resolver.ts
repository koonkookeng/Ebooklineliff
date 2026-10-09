// SSOT Phase 096 — Point claim GQL intents (096-owned, 083 file untouched)
// Canonical: apps/backend/src/modules/gamification/presentation/graphql/squad-points.resolver.ts
// - Mutations claimGamificationPoints / createSquadChallenge. Zero new deps.
import { Args, Field, ID, InputType, Int, Mutation, ObjectType, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { PointEngineService } from '../../services/point-engine.service';
import type { SquadRepository } from '../../../squad/domain/squad.repository.interface';
import { PrismaSquadRepository } from '../../../squad/infrastructure/persistence/prisma-squad.repository';

@ObjectType('PointClaimResultPayload')
class PointClaimResultPayloadGql {
  @Field()
  success!: boolean;

  @Field(() => Int)
  pointsEarned!: number;

  @Field(() => Int)
  newTotalPoints!: number;

  @Field(() => Int)
  squadBonusEarned!: number;
}

@ObjectType('SquadChallengePayload')
class SquadChallengePayloadGql {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field(() => Int)
  targetPoints!: number;

  @Field(() => Int)
  rewardPoints!: number;
}

@InputType('ClaimPointInput')
class ClaimPointInputGql {
  @Field()
  activityType!: string;

  @Field(() => ID)
  referenceId!: string;

  @Field(() => Int)
  dwellTimeSec!: number;

  @Field()
  signatureNonce!: string;

  @Field(() => ID, { nullable: true })
  squadId?: string;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Resolver('SquadPoints')
export class SquadPointsResolver {
  constructor(
    private readonly points: PointEngineService,
    private readonly squads: PrismaSquadRepository,
  ) {}

  @Mutation('claimGamificationPoints')
  async claimGamificationPoints(@Args('input') input: ClaimPointInputGql, @Context() ctx: LooseCtx) {
    const r = await this.points.claim({
      userId: actorOf(ctx),
      squadId: input.squadId,
      input: {
        activityType: input.activityType,
        referenceId: input.referenceId,
        dwellTimeSec: input.dwellTimeSec,
        signatureNonce: input.signatureNonce,
      },
    });
    const out = new PointClaimResultPayloadGql();
    out.success = true;
    out.pointsEarned = r.pointsEarned;
    out.newTotalPoints = r.newTotalPoints;
    out.squadBonusEarned = r.squadBonusEarned;
    return out;
  }

  @Mutation('createSquadChallenge')
  async createSquadChallenge(
    @Args('squadId') squadId: string,
    @Args('targetPoints', { type: () => Int }) targetPoints: number,
    @Args('title') title: string,
    @Context() ctx: LooseCtx,
  ) {
    actorOf(ctx);
    const repo: SquadRepository = this.squads;
    const row = await repo.createChallenge({
      squadId,
      title,
      targetPoints,
      rewardPoints: Math.floor(targetPoints / 2),
      endDate: new Date(Date.now() + 7 * 86400 * 1000),
    });
    const out = new SquadChallengePayloadGql();
    out.id = row.id;
    out.title = row.title;
    out.targetPoints = row.targetPoints;
    out.rewardPoints = row.rewardPoints;
    return out;
  }
}

export { PointClaimResultPayloadGql, SquadChallengePayloadGql };
