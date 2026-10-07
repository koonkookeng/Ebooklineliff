// SSOT Phase 046 Task 3 — ProgressResolver (buffered sync mutation)
// Canonical: apps/backend/src/modules/stream/progress/progress.resolver.ts
// (legacy src/backend/modules/stream/progress/progress.resolver.ts)
// - Mutation.syncLessonProgressBuffered: the §3.2 write-behind fast path
//   (SyncProgressInput → SyncProgressPayload shapes verbatim). The bare
//   `syncLessonProgress` field stays owned by StreamPlaybackResolver
//   (Phase 045, now buffer-delegated) — two resolvers must never register
//   the same field or code-first schema generation fails.
// - Zero new deps.
import { Args, Context, Field, ID, InputType, Int, Mutation, ObjectType, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { SyncProgressInputSchema } from '@repo/shared';
import { ProgressService } from './progress.service';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../reader/reader-identity';

@InputType('ProgressSyncInput')
class ProgressSyncInputGql {
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) watchedSec!: number;
  @Field(() => Int) durationSec!: number;
  @Field() isCompleted!: boolean;
  @Field() clientTimestamp!: string;
}

@ObjectType('ProgressSyncPayload')
class ProgressSyncPayloadGql {
  @Field() success!: boolean;
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) savedWatchedSec!: number;
  @Field() isCompleted!: boolean;
  @Field() serverTimestamp!: string;
}

@Resolver('Progress')
export class ProgressResolver {
  constructor(private readonly progress: ProgressService) {}

  @Mutation('syncLessonProgressBuffered')
  @UseGuards(JwtAuthGuard)
  async syncLessonProgressBuffered(@Args('input') input: ProgressSyncInputGql, @Context() gqlCtx?: ReaderGqlContext) {
    const parsed = SyncProgressInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid progress input');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.progress.bufferProgressSync(userId, parsed.data);
  }
}
