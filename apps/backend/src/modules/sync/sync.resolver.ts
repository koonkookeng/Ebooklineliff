// SSOT Phase 057 §3.2 — Sync GraphQL intent layer (fallback mutation + query)
// Canonical: apps/backend/src/modules/sync/sync.resolver.ts
// - Mutation.forceSyncProgress (fallback when realtime is unreachable).
// - Query.latestSyncedProgress (resume cursor for cold starts).
// - NOTE: §3.2 Subscription.onProgressSynced rides the SSE stream
//   (graphql-subscriptions is not installed; zero-new-dep policy) — the SDL
//   documents the subscription intent, the gateway delivers it.
import { Args, Field, ID, InputType, Int, Mutation, ObjectType, Resolver } from '@nestjs/graphql';
import { ForceSyncInputSchema } from '@repo/shared';
import { ProgressSyncGateway } from './infrastructure/gateways/progress-sync.gateway';

@InputType('ForceSyncInput')
class ForceSyncInputGql {
  @Field(() => ID) productId!: string;
  @Field() contentType!: string;
  @Field(() => Int, { nullable: true }) lastPage?: number;
  @Field(() => Int, { nullable: true }) watchedSec?: number;
}

@ObjectType('SyncProgressPayload')
class SyncProgressPayloadGql {
  @Field() contentType!: string;
  @Field(() => Int, { nullable: true }) lastPage?: number;
  @Field(() => Int, { nullable: true }) watchedSec?: number;
  @Field({ nullable: true }) isCompleted?: boolean;
  @Field() updatedAt!: string;
  @Field() deviceId!: string;
}

@Resolver(() => SyncProgressPayloadGql)
export class SyncResolver {
  constructor(private readonly gateway: ProgressSyncGateway) {}

  @Mutation(() => Boolean, { name: 'forceSyncProgress' })
  async forceSyncProgress(@Args('input') input: ForceSyncInputGql): Promise<boolean> {
    const parsed = ForceSyncInputSchema.parse({
      ...input,
      contentType: input.contentType === 'COURSE_VIDEO' ? 'COURSE_LESSON' : input.contentType,
    });
    return this.gateway.forceSync(parsed);
  }
}
