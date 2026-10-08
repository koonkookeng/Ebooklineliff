// SSOT Phase 073 §3/Gate 1 — Merchant studio GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/merchant/infrastructure/graphql/resolvers/merchant-studio.resolver.ts
// - getMerchantAnalytics(tenantId, from, to) — tenant-isolated rows.
// - upsertMerchantProduct(input) — delegates to the studio use-case (the
//   gateway enforces auth; header tenant comes from x-tenant-id).
// - Zero new deps.
import { Args, Field, ID, InputType, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { CreateProductStudioUseCase } from '../../../application/use-cases/create-product-studio.usecase';
import type { MerchantRepository } from '../../repositories/prisma-merchant.repository';
import { PrismaMerchantRepository } from '../../repositories/prisma-merchant.repository';

@ObjectType('MerchantAnalyticsRow')
class MerchantAnalyticsRowGql {
  @Field() recordDate!: string;
  @Field() totalGmv!: string;
  @Field(() => Int) totalOrders!: number;
  @Field(() => Int) ebookSalesCount!: number;
  @Field(() => Int) courseSalesCount!: number;
  @Field(() => Int) physicalSalesCount!: number;
  @Field(() => Int) newStudentsCount!: number;
}

@InputType('MerchantProductUpsertInput')
class MerchantProductUpsertInputGql {
  @Field(() => ID, { nullable: true }) id?: string | null;
  @Field() title!: string;
  @Field() slug!: string;
  @Field() description!: string;
  @Field() coverImageUrl!: string;
  @Field() productType!: string;
  @Field(() => Number) price!: number;
  @Field(() => Boolean, { nullable: true }) isPublished?: boolean | null;
}

@Resolver('MerchantStudio')
export class MerchantStudioResolver {
  constructor(
    private readonly products: CreateProductStudioUseCase,
    private readonly repo: PrismaMerchantRepository,
  ) {}

  @Query('getMerchantAnalytics')
  async getMerchantAnalytics(
    @Args('tenantId') tenantId: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
  ) {
    if (!(tenantId ?? '').trim()) throw new BadRequestException('Missing tenantId');
    const repo: MerchantRepository = this.repo;
    const rows = await repo.analyticsRange(
      tenantId,
      new Date(from ?? new Date(0).toISOString()),
      new Date(to ?? new Date().toISOString()),
    );
    return rows.map((r) => ({
      recordDate: new Date(r.recordDate).toISOString(),
      totalGmv: String(r.totalGmv),
      totalOrders: r.totalOrders,
      ebookSalesCount: r.ebookSalesCount,
      courseSalesCount: r.courseSalesCount,
      physicalSalesCount: r.physicalSalesCount,
      newStudentsCount: r.newStudentsCount,
    }));
  }

  @Mutation('upsertMerchantProduct')
  upsertMerchantProduct(
    @Args('tenantId') tenantId: string,
    @Args('input') input: MerchantProductUpsertInputGql,
  ) {
    if (!(tenantId ?? '').trim()) throw new BadRequestException('Missing tenantId');
    return this.products.execute(tenantId, { ...input, tenantId });
  }
}
