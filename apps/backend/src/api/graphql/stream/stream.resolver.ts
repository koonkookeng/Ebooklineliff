// SSOT Phase 045 Task 1/§3.2 — StreamResolver (playback intent layer)
// Canonical: apps/backend/src/api/graphql/stream/stream.resolver.ts
// (legacy src/backend/api/graphql/stream/stream.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/stream.graphql/schema.graphql.
// - Query.getLessonStreamState(lessonId): manifest + resume + watermark.
// - Mutation.syncLessonProgress: 5s heartbeat (DB upsert + heatmap event).
// - Both ride StreamService (no HTTP hop); identity from @Context().
// - Zero new deps.
import { Args, Context, Field, Float, ID, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { SyncLessonProgressSchema } from '@repo/shared';
import { StreamService } from '../../../modules/stream/services/stream.service';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../../modules/reader/reader-identity';

@ObjectType('StreamWatermarkPayload')
class StreamWatermarkPayloadGql {
  @Field() userIdHash!: string;
  @Field() displayName!: string;
  @Field() timestamp!: string;
}

@ObjectType('LessonStreamPayload')
class LessonStreamPayloadGql {
  @Field(() => ID) lessonId!: string;
  @Field() hlsManifestUrl!: string;
  @Field() signedEdgeToken!: string;
  @Field(() => Int) lastWatchedSec!: number;
  @Field(() => Int) durationSec!: number;
  @Field(() => StreamWatermarkPayloadGql) forensicWatermark!: StreamWatermarkPayloadGql;
}

@ObjectType('StreamProgressSyncResponse')
class StreamProgressSyncResponseGql {
  @Field() success!: boolean;
  @Field() updatedAt!: string;
  @Field() isCompleted!: boolean;
}

@InputType('SyncLessonProgressInput')
class SyncLessonProgressInputGql {
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) watchedSec!: number;
  @Field(() => Int) durationSec!: number;
  @Field() isCompleted!: boolean;
}

interface StreamHttpReq {
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function ipOf(ctx: ReaderGqlContext | undefined): string {
  const req = (ctx as unknown as { req?: StreamHttpReq })?.req;
  return req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || 'unknown';
}

@Resolver('Stream')
export class StreamPlaybackResolver {
  constructor(private readonly stream: StreamService) {}

  @Query('getLessonStreamState')
  @UseGuards(JwtAuthGuard)
  async getLessonStreamState(@Args('lessonId') lessonId: string, @Context() gqlCtx?: ReaderGqlContext) {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.stream.getLessonStreamState(userId, lessonId, ipOf(gqlCtx));
  }

  @Mutation('syncLessonProgress')
  @UseGuards(JwtAuthGuard)
  async syncLessonProgress(
    @Args('input') input: SyncLessonProgressInputGql,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const parsed = SyncLessonProgressSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid lesson progress');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.stream.syncLessonProgress(userId, parsed.data);
  }
}
