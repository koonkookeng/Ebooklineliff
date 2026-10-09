// SSOT Phase 099 — Live GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/resolvers/live.resolver.ts
// - Query getLiveSession / Mutations joinLiveSession + voteLivePoll.
//   Streaming chat rides SSE REST (no WS deps). Zero new deps.
import { Args, Field, ID, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { MintPlaybackTokenUseCase } from '../../../modules/live/application/use-cases/mint-ivs-token.usecase';
import { PrismaLiveRepository } from '../../../modules/live/infrastructure/persistence/live-session.repository';

@ObjectType('LiveWatermark')
class LiveWatermarkGql {
  @Field()
  text!: string;

  @Field()
  userIdHash!: string;

  @Field()
  timestamp!: string;
}

@ObjectType('LiveAccessPayload')
class LiveAccessPayloadGql {
  @Field(() => ID)
  sessionId!: string;

  @Field()
  vendor!: string;

  @Field()
  playbackUrl!: string;

  @Field({ nullable: true })
  playbackToken?: string;

  @Field(() => LiveWatermarkGql)
  watermarkData!: LiveWatermarkGql;

  @Field()
  expiresAt!: string;
}

@ObjectType('LiveSessionInfo')
class LiveSessionInfoGql {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field()
  vendor!: string;

  @Field()
  status!: string;

  @Field(() => Int)
  peakViewers!: number;
}

@ObjectType('LivePollTallyRow')
class LivePollTallyRowGql {
  @Field(() => ID)
  optionId!: string;

  @Field(() => Int)
  votes!: number;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Injectable()
@Resolver('Live')
export class LiveResolver {
  constructor(
    private readonly access: MintPlaybackTokenUseCase,
    private readonly repo: PrismaLiveRepository,
  ) {}

  @Query('getLiveSession')
  async getLiveSession(@Args('sessionId') sessionId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    const s = await this.repo.findSessionById(sessionId);
    if (!s) throw new BadRequestException('Live session not found');
    const out = new LiveSessionInfoGql();
    out.id = s.id;
    out.title = s.title;
    out.vendor = s.vendor;
    out.status = s.status;
    out.peakViewers = s.peakViewers;
    return out;
  }

  @Mutation('joinLiveSession')
  async joinLiveSession(@Args('sessionId') sessionId: string, @Context() ctx: LooseCtx) {
    const r = await this.access.join({ sessionId, userId: actorOf(ctx) });
    const out = new LiveAccessPayloadGql();
    out.sessionId = r.sessionId;
    out.vendor = r.vendor;
    out.playbackUrl = r.playbackUrl;
    out.playbackToken = r.playbackToken;
    const wm = new LiveWatermarkGql();
    wm.text = r.watermarkData.text;
    wm.userIdHash = r.watermarkData.userIdHash;
    wm.timestamp = r.watermarkData.timestamp;
    out.watermarkData = wm;
    out.expiresAt = r.expiresAt;
    return out;
  }

  @Mutation('voteLivePoll')
  voteLivePoll(
    @Args('pollId') pollId: string,
    @Args('optionId') optionId: string,
    @Context() ctx: LooseCtx,
  ) {
    const userId = actorOf(ctx);
    return this.repo.votePoll({ pollId, optionId, userId }).then(() => this.tallyOf(pollId));
  }

  @Query('livePollTally')
  livePollTally(@Args('pollId') pollId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    return this.tallyOf(pollId);
  }

  private async tallyOf(pollId: string) {
    const tally = await this.repo.pollTally(pollId);
    return tally.map((t) => {
      const g = new LivePollTallyRowGql();
      g.optionId = t.optionId;
      g.votes = t.votes;
      return g;
    });
  }
}

export { LiveAccessPayloadGql, LiveSessionInfoGql };
