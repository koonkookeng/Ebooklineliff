// SSOT Phase 064 §5.1 — CourseProgressResolver (offline course batch GQL)
// Canonical: apps/backend/src/modules/progress/resolvers/course-progress.resolver.ts
// (legacy src/backend/modules/progress/resolvers/course-progress.resolver.ts)
// - Mutation.syncOfflineCourseBatch(items): JWT identity; shared service.
// - Zero new deps.
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import { CourseProgressSyncItemSchema } from '@repo/shared';
import { ProgressSyncService } from '../services/progress-sync.service';

interface BatchGqlContext {
  req?: { user?: { id?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

@Resolver('CourseProgress')
export class CourseProgressResolver {
  constructor(private readonly sync: ProgressSyncService) {}

  @Mutation('syncOfflineCourseBatch')
  async syncOfflineCourseBatch(
    @Args('items') items: Array<Record<string, unknown>>,
    @Context() ctx: BatchGqlContext,
  ) {
    const userId = ctx?.req?.user?.id;
    if (!userId) throw new Error('Missing session identity');
    const list: unknown[] = [];
    for (const i of Array.isArray(items) ? items : []) {
      const parsed = CourseProgressSyncItemSchema.safeParse(i);
      if (parsed.success) list.push(parsed.data);
    }
    const ip = ctx?.req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx?.req?.ip || 'unknown';
    return this.sync.processBatchSync(
      userId,
      { syncBatchId: randomUUID(), userId, ebookProgressList: [], courseProgressList: list },
      ip,
      'GraphQL-OfflineBatch',
    );
  }
}
