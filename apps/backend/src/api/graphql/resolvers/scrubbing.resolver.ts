// SSOT Phase 058 §5.2 — ScrubbingResolver (code-first, entitlement-gated manifest)
// Canonical: apps/backend/src/api/graphql/resolvers/scrubbing.resolver.ts
// (legacy src/backend/api/graphql/resolvers/scrubbing.resolver.ts)
// - Query.getScrubbingManifest(lessonId): JWT context → service → payload.
// - Decorator-free business path lives in the service (tsx-safe); this file
//   keeps the thin Nest code-first shell (parity-checked, not tsx-imported).
// - Zero new deps.
import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import { ScrubbingManifestInputSchema } from '@repo/shared';
import { ThumbnailScrubbingService } from '../../../modules/stream/services/thumbnail-scrubbing.service';

interface GqlContext {
  req?: { user?: { id?: string } };
}

@Resolver('Scrubbing')
export class ScrubbingResolver {
  constructor(private readonly scrubbing: ThumbnailScrubbingService) {}

  @Query('getScrubbingManifest')
  async getScrubbingManifest(@Args('lessonId') lessonId: string, @Context() ctx: GqlContext) {
    const parsed = ScrubbingManifestInputSchema.safeParse({ lessonId });
    if (!parsed.success) throw new Error('Invalid lessonId');
    const userId = ctx?.req?.user?.id;
    if (!userId) throw new Error('Missing session identity');
    try {
      const { manifest, watermarkText } = await this.scrubbing.getScrubbingManifest(userId, parsed.data.lessonId);
      return { success: true, manifest, watermarkText };
    } catch (e) {
      return { success: false, manifest: null, watermarkText: '', errorMessage: e instanceof Error ? e.message : 'Scrubbing unavailable' };
    }
  }
}
