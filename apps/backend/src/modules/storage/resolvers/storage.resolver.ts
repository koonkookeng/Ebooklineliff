// SSOT Phase 123 Task 6 §3.2 — storage GraphQL intents (code-first shell)
// Canonical: apps/backend/src/modules/storage/resolvers/storage.resolver.ts
// - Thin decorator shell over StorageHandler (115 precedent: behavior
//   lives in the decorator-free handler, fully covered by contract tests).
// - Zero new deps.
import { Args, Context, Field, Float, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import {
  StorageHandler,
  type BudgetConfigInput,
  type LifecycleRuleInput,
  type LifecycleRuleView,
  type StorageBudgetView,
  type StorageMetricView,
  type StorageUser,
} from '../services/storage-handler.service';

@ObjectType('StorageUsageMetric')
class StorageUsageMetricNode implements StorageMetricView {
  @Field(() => Float) totalSizeBytes!: number;
  @Field(() => Int) totalObjectsCount!: number;
  @Field(() => Int) classAOperationsCount!: number;
  @Field(() => Int) classBOperationsCount!: number;
  @Field(() => Float) estimatedMonthlyCostTHB!: number;
  @Field() recordedAt!: string;
}

@ObjectType('R2LifecycleRule')
class R2LifecycleRuleNode implements LifecycleRuleView {
  @Field() ruleId!: string;
  @Field() prefix!: string;
  @Field() enabled!: boolean;
  @Field(() => Int, { nullable: true }) expireDays!: number | null;
  @Field(() => Int) abortIncompleteMultipartDays!: number;
  @Field({ nullable: true }) description!: string | null;
}

@ObjectType('StorageBudgetConfig')
class StorageBudgetConfigNode implements StorageBudgetView {
  @Field() tenantId!: string;
  @Field(() => Float) monthlyBudgetLimitTHB!: number;
  @Field(() => Float) warningThresholdPercent!: number;
  @Field(() => Float) criticalThresholdPercent!: number;
  @Field(() => [String]) notifyLineUserIds!: string[];
  @Field() autoPurgeTempOnExceed!: boolean;
}

@InputType()
class R2LifecycleRuleInput implements LifecycleRuleInput {
  @Field() ruleId!: string;
  @Field() prefix!: string;
  @Field() enabled!: boolean;
  @Field(() => Int, { nullable: true }) expireDays?: number | null;
  @Field(() => Int, { nullable: true }) abortIncompleteMultipartDays?: number | null;
  @Field({ nullable: true }) description?: string | null;
}

@InputType()
class StorageBudgetConfigInput implements BudgetConfigInput {
  @Field() tenantId!: string;
  @Field(() => Float) monthlyBudgetLimitTHB!: number;
  @Field(() => Float, { nullable: true }) warningThresholdPercent?: number | null;
  @Field(() => Float, { nullable: true }) criticalThresholdPercent?: number | null;
  @Field(() => [String]) notifyLineUserIds!: string[];
  @Field({ nullable: true }) autoPurgeTempOnExceed?: boolean | null;
}

type LooseCtx = Record<string, unknown>;

function userOf(ctx: LooseCtx): StorageUser | undefined {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  return (req['user'] as StorageUser | undefined) ?? undefined;
}

@Resolver('Storage')
export class StorageResolver {
  constructor(private readonly handler: StorageHandler) {}

  @Query('getStorageUsageMetrics')
  getStorageUsageMetrics(@Args('tenantId') tenantId: string, @Context() ctx: LooseCtx) {
    return this.handler.getStorageUsageMetrics(tenantId, userOf(ctx));
  }

  @Query('getR2LifecycleRules')
  getR2LifecycleRules(@Args('bucketName') bucketName: string, @Context() ctx: LooseCtx) {
    return this.handler.getR2LifecycleRules(bucketName, userOf(ctx));
  }

  @Query('getStorageBudgetConfig')
  getStorageBudgetConfig(@Args('tenantId') tenantId: string, @Context() ctx: LooseCtx) {
    return this.handler.getStorageBudgetConfig(tenantId, userOf(ctx));
  }

  @Mutation('updateR2LifecycleRules')
  updateR2LifecycleRules(
    @Args('bucketName') bucketName: string,
    @Args('rules') rules: R2LifecycleRuleInput[],
    @Context() ctx: LooseCtx,
  ) {
    return this.handler.updateR2LifecycleRules(bucketName, rules, userOf(ctx));
  }

  @Mutation('updateStorageBudgetConfig')
  updateStorageBudgetConfig(@Args('input') input: StorageBudgetConfigInput, @Context() ctx: LooseCtx) {
    return this.handler.updateStorageBudgetConfig(input, userOf(ctx));
  }

  @Mutation('triggerManualR2StorageCleanup')
  triggerManualR2StorageCleanup(
    @Args('bucketName') bucketName: string,
    @Args('prefix') prefix: string,
    @Context() ctx: LooseCtx,
  ) {
    return this.handler.triggerManualR2StorageCleanup(bucketName, prefix, userOf(ctx));
  }
}
