// SSOT Phase 102 §3.2 — VOD pipeline GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/resolvers/stream.resolver.ts
// - Mutations completeLiveSession + retranscodeFailedVOD; Query vodStatus
//   (progress probe — GQL subscriptions need WS, SSE/proxy polling instead).
// - Zero new deps.
import { Args, Field, Float, ID, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { LiveToVodService } from '../../../modules/stream/application/live-to-vod.service';
import { TranscodeProcessorWorker } from '../../../modules/stream/application/transcode-processor.worker';
import { LessonService } from '../../../modules/course/lesson.service';

@ObjectType('LiveToVODStatusPayload')
class LiveToVODStatusPayloadGql {
  @Field(() => ID)
  lessonId!: string;

  @Field()
  status!: string;

  @Field(() => Float)
  progressPct!: number;

  @Field({ nullable: true })
  hlsPlaylistUrl?: string | null;

  @Field(() => Int, { nullable: true })
  durationSec?: number | null;

  @Field({ nullable: true })
  aiSummary?: string | null;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Injectable()
@Resolver('StreamVod')
export class StreamResolver {
  constructor(
    private readonly pipeline: LiveToVodService,
    private readonly worker: TranscodeProcessorWorker,
    private readonly lessons: LessonService,
  ) {}

  @Mutation('completeLiveSession')
  async completeLiveSession(
    @Args('sessionId') sessionId: string,
    @Args('lessonId') lessonId: string,
    @Context() ctx: LooseCtx,
  ) {
    actorOf(ctx);
    if (!sessionId || !lessonId) throw new BadRequestException('Invalid complete request');
    const ingested = await this.pipeline.ingest({
      eventId: '00000000-0000-4000-8000-000000000000',
      sessionId,
      lessonId,
      tenantId: 'default',
      eventType: 'STREAM_END',
      timestamp: new Date().toISOString(),
    });
    return this.statusOf(lessonId, sessionId, ingested.queued ? 'PROCESSING_VOD' : 'VOD_AVAILABLE');
  }

  @Mutation('retranscodeFailedVOD')
  async retranscodeFailedVOD(
    @Args('sessionId') sessionId: string,
    @Args('lessonId') lessonId: string,
    @Context() ctx: LooseCtx,
  ) {
    actorOf(ctx);
    await this.worker.run({ liveSessionId: sessionId, lessonId, tenantId: 'default' });
    return true;
  }

  @Query('vodStatus')
  async vodStatus(@Args('lessonId') lessonId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    return this.statusOf(lessonId, '', 'PROCESSING_VOD');
  }

  private async statusOf(lessonId: string, sessionId: string, fallback: string) {
    const pct = await this.pipeline.progressOf(lessonId);
    const row = await this.lessons.findVod(lessonId).catch(() => null);
    const ready = (row?.isLiveRecorded && row.videoHlsUrl) || pct >= 100;
    const out = new LiveToVODStatusPayloadGql();
    out.lessonId = lessonId;
    out.status = ready ? 'VOD_AVAILABLE' : fallback;
    out.progressPct = ready ? 100 : pct;
    out.hlsPlaylistUrl = row?.videoHlsUrl ?? null;
    out.durationSec = row?.durationSec ?? null;
    out.aiSummary = row?.aiSummaryText ?? null;
    void sessionId;
    return out;
  }
}

export { LiveToVODStatusPayloadGql };
