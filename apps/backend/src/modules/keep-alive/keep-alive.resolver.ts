// SSOT Phase 031 Task 8/§3.2 — Keep-alive GraphQL presentation (code-first)
// Canonical: apps/backend/src/modules/keep-alive/keep-alive.resolver.ts
// (legacy src/backend/api/graphql/resolvers/keep-alive.resolver.ts — alias kept)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/keep-alive.graphql/schema.graphql.
// - Zero new deps.
import { Resolver, Query, Mutation, Args, ObjectType, Field, InputType } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { KeepAliveService } from './keep-alive.service';

@ObjectType('KeepAliveSyncResponse')
class KeepAliveSyncResponseGql {
  @Field() success!: boolean;
  @Field() restoredTimestamp!: string;
  @Field({ nullable: true }) message!: string | null;
  @Field({ nullable: true }) stateJson!: string | null;
}

@InputType('EbookStateInput')
class EbookStateInputGql {
  @Field(() => String) productId!: string;
  @Field() currentPage!: number;
  @Field({ nullable: true }) scrollOffsetTop!: number | null;
  @Field({ nullable: true }) zoomScale!: number | null;
  @Field({ nullable: true }) activeChapterId!: string | null;
}

@InputType('VideoStateInput')
class VideoStateInputGql {
  @Field(() => String) lessonId!: string;
  @Field({ nullable: true }) playedSeconds!: number | null;
  @Field({ nullable: true }) playbackRate!: number | null;
}

@InputType('KeepAliveSyncInput')
class KeepAliveSyncInputGql {
  @Field({ nullable: true }) tenantId!: string | null;
  @Field() viewportType!: string;
  @Field({ nullable: true }) ebookState!: EbookStateInputGql | null;
  @Field({ nullable: true }) videoState!: VideoStateInputGql | null;
}

@Resolver('KeepAlive')
export class KeepAliveResolver {
  constructor(private readonly states: KeepAliveService) {}

  @Query('getLatestKeepAliveState')
  async getLatestKeepAliveState(
    @Args('tenantId') tenantId: string,
    @Args('viewportType') viewportType: string,
    @Args('userId') userId: string,
  ) {
    if (!tenantId || !viewportType || !userId) throw new BadRequestException('Missing keep-alive identity');
    try {
      const out = await this.states.latestState(userId, tenantId, viewportType);
      return { success: true, restoredTimestamp: out.restoredTimestamp, message: null, stateJson: JSON.stringify(out.stateJson ?? null) };
    } catch {
      return { success: false, restoredTimestamp: new Date(0).toISOString(), message: 'No keep-alive state found', stateJson: null };
    }
  }

  @Mutation('syncKeepAliveState')
  async syncKeepAliveState(@Args('input') input: KeepAliveSyncInputGql, @Args('userId') userId: string) {
    if (!input?.viewportType || !userId) throw new BadRequestException('Missing keep-alive identity');
    const out = await this.states.syncState({
      userId,
      tenantId: input.tenantId ?? 'default',
      viewportType: input.viewportType,
      timestamp: Date.now(),
      ...(input.ebookState ? { ebookState: input.ebookState } : {}),
      ...(input.videoState ? { videoState: input.videoState } : {}),
    });
    return { success: out.success, restoredTimestamp: out.restoredTimestamp, message: null, stateJson: null };
  }
}
