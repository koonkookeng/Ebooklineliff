// SSOT Phase 061 §5.1 — DrmReaderResolver (code-first thin shell)
// Canonical: apps/backend/src/api/graphql/resolvers/drm-reader.resolver.ts
// (legacy src/backend/api/graphql/resolvers/drm-reader.resolver.ts)
// - Query.getDrmScrambledChunk / Mutation.reportDrmViolation — JWT context
//   identity; logic lives in CanvasShufflingService (tsx-safe).
// - Zero new deps.
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { DrmChunkRequestSchema, DrmViolationReportSchema } from '../../../modules/reader/drm/dto/drm-chunk-request.dto';
import { CanvasShufflingService } from '../../../modules/reader/drm/canvas-shuffling.service';

interface DrmGqlContext {
  req?: { user?: { id?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

@Resolver('DrmReader')
export class DrmReaderResolver {
  constructor(private readonly shuffling: CanvasShufflingService) {}

  @Query('getDrmScrambledChunk')
  async getDrmScrambledChunk(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Context() ctx: DrmGqlContext,
  ) {
    const parsed = DrmChunkRequestSchema.safeParse({ productId, pageNumber });
    if (!parsed.success) throw new Error('Invalid DRM chunk params');
    const userId = ctx?.req?.user?.id;
    if (!userId) throw new Error('Missing session identity');
    const ip = ctx?.req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx?.req?.ip || 'unknown';
    return this.shuffling.getDrmChunk(userId, parsed.data.productId, parsed.data.pageNumber, 8, 8, 'HYBRID_WEBGL_MATRIX', ip);
  }

  @Mutation('reportDrmViolation')
  async reportDrmViolation(
    @Args('input') input: Record<string, unknown>,
    @Context() ctx: DrmGqlContext,
  ) {
    const parsed = DrmViolationReportSchema.safeParse(input);
    if (!parsed.success) throw new Error('Invalid violation report');
    const userId = ctx?.req?.user?.id;
    if (!userId) throw new Error('Missing session identity');
    const ip = ctx?.req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx?.req?.ip || 'unknown';
    return (await this.shuffling.reportViolation(userId, parsed.data, ip)).logged;
  }
}
