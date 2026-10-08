// SSOT Phase 067 §3.2 — QualityResolver (code-first manifest + telemetry)
// Canonical: apps/backend/src/modules/stream/quality/quality.resolver.ts
// (legacy src/backend/modules/stream/quality.resolver.ts)
// - Query.getCourseLessonManifest / Mutation.reportStreamTelemetry over the
//   shared QualitySelectorService (no logic duplication with REST).
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { QualitySelectorService } from './quality-selector.service';

interface QualityGqlContext {
  req?: { user?: { id?: string } };
}

@Resolver('StreamManifest')
export class QualityResolver {
  constructor(private readonly quality: QualitySelectorService) {}

  private userId(ctx: QualityGqlContext): string {
    const id = ctx?.req?.user?.id;
    if (!id) throw new Error('Missing session identity');
    return id;
  }

  @Query('getCourseLessonManifest')
  async getCourseLessonManifest(@Args('lessonId') lessonId: string, @Context() ctx: QualityGqlContext) {
    const res = await this.quality.getQualityManifest(this.userId(ctx), String(lessonId));
    if (!res.ok || !res.manifest) throw new Error(res.error ?? 'MANIFEST_FAILED');
    return res.manifest;
  }

  @Mutation('reportStreamTelemetry')
  async reportStreamTelemetry(@Args('input') input: Record<string, unknown>, @Context() ctx: QualityGqlContext) {
    const res = await this.quality.reportTelemetry(this.userId(ctx), input ?? {});
    return res.recorded;
  }
}
