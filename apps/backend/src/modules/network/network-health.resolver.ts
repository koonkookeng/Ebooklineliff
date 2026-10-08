// SSOT Phase 069 §3.2 — NetworkHealthResolver (code-first ping + flush)
// Canonical: apps/backend/src/modules/network/network-health.resolver.ts
// (legacy src/backend/modules/network/network-health.resolver.ts)
// - Query.networkPingCheck / Mutation.flushOfflineQueue over the shared
//   services (no logic duplication with REST).
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NetworkHealthService } from './network-health.service';
import { OfflineSyncService } from './services/offline-sync.service';

interface NetworkGqlContext {
  req?: { user?: { id?: string } };
}

@Resolver('NetworkHealth')
export class NetworkHealthResolver {
  constructor(
    private readonly health: NetworkHealthService,
    private readonly offlineSync: OfflineSyncService,
  ) {}

  private userId(ctx: NetworkGqlContext): string {
    const id = ctx?.req?.user?.id;
    if (!id) throw new Error('Missing session identity');
    return id;
  }

  @Query('networkPingCheck')
  async networkPingCheck(@Args('clientTimestamp') clientTimestamp: number) {
    const serverTimestamp = Date.now();
    return {
      status: 'ok',
      serverTimestamp,
      roundTripLatencyMs: Math.max(0, serverTimestamp - Math.floor(Number(clientTimestamp) || serverTimestamp)),
    };
  }

  @Mutation('flushOfflineQueue')
  async flushOfflineQueue(@Args('items') items: Array<Record<string, unknown>>, @Context() ctx: NetworkGqlContext) {
    const result = await this.offlineSync.processBatchQueue(Array.isArray(items) ? items : [], this.userId(ctx));
    return { success: result.failedItemIds.length === 0, processedCount: result.processedCount, failedItemIds: result.failedItemIds };
  }
}
