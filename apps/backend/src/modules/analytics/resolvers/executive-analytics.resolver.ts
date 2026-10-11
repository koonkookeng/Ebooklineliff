// SSOT Phase 116 Task 4 §3.2 — executive BI GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/analytics/resolvers/executive-analytics.resolver.ts
// - Query.executiveSummary / Query.cohortMatrix / Query.revenueBreakdown /
//   Mutation.runNightlySnapshot. Finance roles only (defense in depth with
//   the REST guards). Zero new deps.
import { Args, Context, Field, Float, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { ExecutiveAnalyticsService } from '../services/executive-analytics.service';
import { DailySnapshotWorker } from '../workers/daily-snapshot.worker';
import { financeOf, type LooseCtx } from './finance-guard';

@ObjectType('ExecutiveKpiSummary')
class ExecutiveKpiSummaryGql {
  @Field(() => Float) gmv!: number;
  @Field(() => Float) netRevenue!: number;
  @Field(() => Int) totalOrders!: number;
  @Field(() => Float) averageOrderValue!: number;
  @Field(() => Float) customerAcquisitionCost!: number;
  @Field(() => Float) customerLifetimeValue!: number;
  @Field(() => Float) churnRatePercentage!: number;
  @Field(() => Int) activeUsersCount!: number;
  @Field(() => Float) gmvGrowthPercentage!: number;
  @Field(() => Float) ltvToCacRatio!: number;
  @Field() calculatedAt!: string;
}

@ObjectType('CohortRetentionPeriodGql')
class CohortRetentionPeriodGql {
  @Field(() => Int) periodIndex!: number;
  @Field(() => Float) activePercentage!: number;
  @Field(() => Int) retainedUsers!: number;
}

@ObjectType('CohortRetentionRow')
class CohortRetentionRowGql {
  @Field() cohortDate!: string;
  @Field(() => Int) totalUsers!: number;
  @Field(() => [CohortRetentionPeriodGql]) retentionRates!: CohortRetentionPeriodGql[];
}

@ObjectType('RevenueBreakdown')
class RevenueBreakdownGql {
  @Field(() => Float) physicalBook!: number;
  @Field(() => Float) ebook!: number;
  @Field(() => Float) course!: number;
  @Field(() => Float) bundle!: number;
}

@Resolver('ExecutiveAnalytics')
export class ExecutiveAnalyticsResolver {
  constructor(
    private readonly bi: ExecutiveAnalyticsService,
    private readonly nightly: DailySnapshotWorker,
  ) {}

  @Query('executiveSummary')
  async executiveSummary(@Args('tenantId', { nullable: true }) tenantId: string | undefined, @Args('timeRange') timeRange: string, @Context() ctx: LooseCtx) {
    const c = financeOf(ctx);
    return this.bi.getExecutiveKpiSummary(tenantId ?? c.tenant, timeRange);
  }

  @Query('cohortMatrix')
  async cohortMatrix(
    @Args('tenantId', { nullable: true }) tenantId: string | undefined,
    @Args('months', { nullable: true }) months: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = financeOf(ctx);
    return this.bi.getCohortMatrix(tenantId ?? c.tenant, months ?? 6);
  }

  @Query('revenueBreakdown')
  async revenueBreakdown(
    @Args('tenantId', { nullable: true }) tenantId: string | undefined,
    @Args('timeRange') timeRange: string,
    @Context() ctx: LooseCtx,
  ) {
    const c = financeOf(ctx);
    return this.bi.getRevenueBreakdown(tenantId ?? c.tenant, timeRange);
  }

  @Mutation('runNightlySnapshot')
  async runNightlySnapshot(
    @Args('tenantId', { nullable: true }) tenantId: string | undefined,
    @Args('date', { nullable: true }) date: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = financeOf(ctx);
    await this.nightly.runOnce([tenantId ?? c.tenant], date ? new Date(date) : new Date());
    return true;
  }
}
