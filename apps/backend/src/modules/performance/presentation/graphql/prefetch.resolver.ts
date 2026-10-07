// SSOT Phase 029 §3.2/Task 5 — Performance GraphQL presentation (code-first)
// Canonical: apps/backend/src/modules/performance/presentation/graphql/prefetch.resolver.ts
// (legacy src/backend/modules/performance/.../prefetch.resolver.ts +
//  src/backend/api/graphql/resolvers/prefetch.resolver.ts — legacy alias kept)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/performance.graphql/schema.graphql.
// - reportClientPerformanceMetrics validates via TelemetryIngestSchema and
//   appends fire-and-forget (always true unless the body is unusable → 400).
// - Zero new deps.
import { Resolver, Query, Mutation, Args, ObjectType, Field, ID, Float, InputType } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { BundleGuardService } from '../../application/services/bundle-guard.service';
import { PredictivePrefetchService } from '../../application/services/predictive-prefetch.service';
import { PrismaPerformanceRepository } from '../../infrastructure/persistence/prisma-performance.repository';
import { PerformanceMetric } from '../../domain/entities/performance-metric.entity';
import { TelemetryIngestSchema, type PerformanceMetricType } from '@repo/shared';

@ObjectType('PerformanceReport')
class PerformanceReportGql {
  @Field(() => ID) id!: string;
  @Field() tenantId!: string;
  @Field() bundleSizeBytes!: number;
  @Field(() => Float) lcpMs!: number;
  @Field() status!: string;
}

@ObjectType('PrefetchPayload')
class PrefetchPayloadGql {
  @Field() success!: boolean;
  @Field() prefetchedCount!: number;
  @Field(() => [String]) cacheStorageKeys!: string[];
  @Field() ttlSeconds!: number;
}

@InputType('PrefetchInput')
class PrefetchInputGql {
  @Field(() => ID) productId!: string;
  @Field() currentResourceType!: string;
  @Field() currentResourceId!: string;
  @Field(() => [String]) predictedNextResourceIds!: string[];
}

@Resolver('Performance')
export class PrefetchResolver {
  constructor(
    private readonly guard: BundleGuardService,
    private readonly prefetch: PredictivePrefetchService,
    private readonly repo: PrismaPerformanceRepository,
  ) {}

  @Query('getBundlePerformanceMetrics')
  async getBundlePerformanceMetrics(@Args('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('Missing tenant id');
    const latest = await this.guard.latest();
    return {
      id: latest?.buildHash ?? 'none',
      tenantId,
      bundleSizeBytes: latest?.totalSizeBytes ?? 0,
      lcpMs: 0,
      status: latest ? (latest.passed ? 'PASS' : 'FAIL') : 'NO_DATA',
    };
  }

  @Mutation('triggerPredictivePrefetch')
  async triggerPredictivePrefetch(
    @Args('input') input: PrefetchInputGql,
    @Args('userId', { nullable: true }) userId?: string | null,
  ) {
    if (!input?.productId) throw new BadRequestException('Missing product id');
    const out = await this.prefetch.processPredictivePrefetch({
      userId: userId ?? 'anonymous',
      productId: input.productId,
      currentResourceType: input.currentResourceType,
      currentResourceId: input.currentResourceId,
      predictedNextResourceIds: input.predictedNextResourceIds,
    });
    return { success: out.success, prefetchedCount: out.prefetchedCount, cacheStorageKeys: out.cacheStorageKeys, ttlSeconds: 900 };
  }

  @Mutation('reportClientPerformanceMetrics')
  async reportClientPerformanceMetrics(
    @Args('metricType') metricType: string,
    @Args('value', { type: () => Float }) value: number,
    @Args('route') route: string,
  ) {
    const parsed = TelemetryIngestSchema.safeParse({ metricType, value, route });
    if (!parsed.success) throw new BadRequestException('Invalid telemetry metric');
    const metric = PerformanceMetric.create({
      tenantId: 'default',
      metricType: parsed.data.metricType as PerformanceMetricType,
      metricValue: parsed.data.value,
      route: parsed.data.route,
      ...(parsed.data.deviceMemory !== undefined ? { deviceMemory: parsed.data.deviceMemory } : {}),
      ...(parsed.data.effectiveType ? { effectiveType: parsed.data.effectiveType } : {}),
    });
    await this.repo.saveMetric(metric.props);
    return true;
  }
}
