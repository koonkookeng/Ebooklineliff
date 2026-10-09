// SSOT Phase 101 §3.2 — Live interaction GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/resolvers/live/live-interaction.resolver.ts
// - Mutations createLiveSession/sendLiveMessage/requestHandRaise/
//   approveHandRaise/createLivePoll/voteLivePoll + Queries livePollResults/
//   liveHandRaiseQueue. Push rides SSE (no WS subscriptions). Zero new deps.
import { Args, Field, Float, ID, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { LiveStreamService } from '../../../../modules/live/services/live-stream.service';
import { LiveChatEngine } from '../../../../modules/live/services/live-chat.engine';
import { LivePollEngine } from '../../../../modules/live/services/live-poll.engine';
import { HandRaiseQueue } from '../../../../modules/live/services/hand-raise.queue';
import { randomUUID } from 'node:crypto';

@ObjectType('LiveChatMessageGql')
class LiveChatMessageGql {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  sessionId!: string;

  @Field(() => ID)
  userId!: string;

  @Field()
  displayName!: string;

  @Field({ nullable: true })
  avatarUrl?: string | null;

  @Field()
  messageType!: string;

  @Field()
  content!: string;

  @Field()
  timestamp!: string;
}

@ObjectType('LivePollOptionGql')
class LivePollOptionGql {
  @Field(() => ID)
  optionId!: string;

  @Field()
  text!: string;

  @Field(() => Int)
  voteCount!: number;

  @Field(() => Float)
  percentage!: number;
}

@ObjectType('LivePollResultGql')
class LivePollResultGql {
  @Field(() => ID)
  pollId!: string;

  @Field()
  question!: string;

  @Field(() => [LivePollOptionGql])
  options!: LivePollOptionGql[];

  @Field(() => Int)
  totalVotes!: number;

  @Field()
  isActive!: boolean;
}

@ObjectType('LiveRaiseGql')
class LiveRaiseGql {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  @Field()
  displayName!: string;

  @Field()
  status!: string;

  @Field(() => Int)
  queuePosition!: number;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Injectable()
@Resolver('LiveInteraction')
export class LiveInteractionResolver {
  constructor(
    private readonly streams: LiveStreamService,
    private readonly chat: LiveChatEngine,
    private readonly polls: LivePollEngine,
    private readonly raises: HandRaiseQueue,
  ) {}

  @Mutation('createLiveSession')
  createLiveSession(@Args('productId') productId: string, @Args('title') title: string, @Context() ctx: LooseCtx) {
    const instructorId = actorOf(ctx);
    if (!productId || title.length < 2) throw new BadRequestException('Invalid session input');
    return this.streams.createSession({
      productId,
      instructorId,
      title,
      scheduledAt: new Date(),
      streamKey: `live-${randomUUID()}`,
    });
  }

  @Mutation('sendLiveMessage')
  async sendLiveMessage(
    @Args('sessionId') sessionId: string,
    @Args('content') content: string,
    @Args('messageType') messageType: string,
    @Args('stickerPackageId', { nullable: true }) stickerPackageId: string | null,
    @Args('stickerId', { nullable: true }) stickerId: string | null,
    @Context() ctx: LooseCtx,
  ) {
    const m = await this.chat.send({
      sessionId,
      userId: actorOf(ctx),
      content,
      messageType,
      stickerPackageId: stickerPackageId ?? undefined,
      stickerId: stickerId ?? undefined,
    });
    const out = new LiveChatMessageGql();
    Object.assign(out, m);
    return out;
  }

  @Mutation('requestHandRaise')
  requestHandRaise(@Args('sessionId') sessionId: string, @Context() ctx: LooseCtx) {
    return this.raises.request(sessionId, actorOf(ctx)).then((r) => {
      const out = new LiveRaiseGql();
      out.id = r.id;
      out.userId = r.userId;
      out.displayName = r.displayName;
      out.status = r.status;
      out.queuePosition = r.queuePosition;
      return out;
    });
  }

  @Mutation('approveHandRaise')
  approveHandRaise(@Args('requestId') requestId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    return this.raises.resolve(requestId, 'APPROVED').then(() => true);
  }

  @Mutation('createLivePoll')
  async createLivePoll(
    @Args('sessionId') sessionId: string,
    @Args('question') question: string,
    @Args('options', { type: () => [String] }) options: string[],
    @Args('durationSec') durationSec: number,
    @Context() ctx: LooseCtx,
  ) {
    actorOf(ctx);
    const r = await this.polls.create({ sessionId, question, options, durationSec });
    return toPollResult(r);
  }

  @Mutation('voteLivePoll')
  async voteLivePoll(@Args('pollId') pollId: string, @Args('optionId') optionId: string, @Context() ctx: LooseCtx) {
    const r = await this.polls.vote({ pollId, optionId, userId: actorOf(ctx) });
    return toPollResult(r);
  }

  @Query('livePollResults')
  livePollResults(@Args('pollId') pollId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    return this.polls.results(pollId).then((r) => toPollResult(r));
  }

  @Query('liveHandRaiseQueue')
  liveHandRaiseQueue(@Args('sessionId') sessionId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    return this.raises.queue(sessionId).then((rows) =>
      (rows as Array<{ id: string; userId: string; displayName: string; status: string; queuePosition: number }>).map((r) => {
        const out = new LiveRaiseGql();
        out.id = r.id;
        out.userId = r.userId;
        out.displayName = r.displayName;
        out.status = r.status;
        out.queuePosition = r.queuePosition;
        return out;
      }),
    );
  }
}

function toPollResult(r: {
  pollId: string; question: string;
  options: Array<{ optionId: string; text: string; votes: number; percentage: number }>;
  totalVotes: number; isActive: boolean;
}): LivePollResultGql {
  const out = new LivePollResultGql();
  out.pollId = r.pollId;
  out.question = r.question;
  out.options = r.options.map((o) => {
    const g = new LivePollOptionGql();
    g.optionId = o.optionId;
    g.text = o.text;
    g.voteCount = o.votes;
    g.percentage = o.percentage;
    return g;
  });
  out.totalVotes = r.totalVotes;
  out.isActive = r.isActive;
  return out;
}

export { LiveChatMessageGql, LivePollResultGql, LiveRaiseGql };
