// SSOT Phase 064 §5.1 — EbookProgressResolver (offline ebook batch GQL)
// Canonical: apps/backend/src/modules/progress/resolvers/ebook-progress.resolver.ts
// (legacy src/backend/modules/progress/resolvers/ebook-progress.resolver.ts)
// - Mutation.syncOfflineEbookBatch(items): JWT identity; delegates to the
//   shared batch service under a generated syncBatchId (idempotent).
// - Zero new deps.
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import { EbookProgressSyncItemSchema } from '@repo/shared';
import { ProgressSyncService } from '../services/progress-sync.service';

interface BatchGqlContext {
  req?: { user?: { id?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

@Resolver('EbookProgress')
export class EbookProgressResolver {
  constructor(private readonly sync: ProgressSyncService) {}

  @Mutation('syncOfflineEbookBatch')
  async syncOfflineEbookBatch(
    @Args('items') items: Array<Record<string, unknown>>,
    @Context() ctx: BatchGqlContext,
  ) {
    const userId = ctx?.req?.user?.id;
    if (!userId) throw new Error('Missing session identity');
    const list: unknown[] = [];
    for (const i of Array.isArray(items) ? items : []) {
      const parsed = EbookProgressSyncItemSchema.safeParse(i);
      if (parsed.success) list.push(parsed.data);
    }
    const ip = ctx?.req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx?.req?.ip || 'unknown';
    return this.sync.processBatchSync(
      userId,
      { syncBatchId: randomUUID(), userId, ebookProgressList: list, courseProgressList: [] },
      ip,
      'GraphQL-OfflineBatch',
    );
  }
}
