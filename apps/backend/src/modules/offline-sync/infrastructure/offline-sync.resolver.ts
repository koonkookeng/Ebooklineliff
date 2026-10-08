// SSOT Phase 062 §3.2 — OfflineSyncResolver (code-first thin shell)
// Canonical: apps/backend/src/modules/offline-sync/infrastructure/offline-sync.resolver.ts
// - Mutation.syncOfflineDataQueue(deviceId, syncItems) — JWT context identity;
//   items ride the same bulk use-case (ownership re-checked inside).
// - Zero new deps.
import { Args, Context, Field, Float, ID, InputType, Mutation, Resolver } from '@nestjs/graphql';
import { ProcessBulkSyncUseCase } from '../application/use-cases/process-bulk-sync.use-case';

interface BulkGqlContext {
  req?: { user?: { id?: string } };
}

@InputType('OfflineSyncItemInput')
class SyncItemInput {
  @Field(() => ID) id!: string;
  @Field() userId!: string;
  @Field() tenantId!: string;
  @Field() targetType!: string;
  @Field() payloadJson!: string;
  @Field(() => Float) timestamp!: number;
}

@Resolver('OfflineSync')
export class OfflineSyncResolver {
  constructor(private readonly bulk: ProcessBulkSyncUseCase) {}

  @Mutation('syncOfflineDataQueue')
  async syncOfflineDataQueue(
    @Args('deviceId') deviceId: string,
    @Args('syncItems') syncItems: SyncItemInput[],
    @Context() ctx: BulkGqlContext,
  ) {
    const userId = ctx?.req?.user?.id;
    if (!userId) throw new Error('Missing session identity');
    const items = (Array.isArray(syncItems) ? syncItems : []).map((i) => {
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(i.payloadJson) as unknown;
        if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
      } catch {
        // malformed payloadJson → failed-store path via empty payload
      }
      return {
        id: i.id,
        userId: i.userId,
        tenantId: i.tenantId,
        targetType: i.targetType,
        payload,
        timestamp: i.timestamp,
        retryCount: 0,
      };
    });
    return this.bulk.execute(userId, { deviceId, syncItems: items });
  }
}
