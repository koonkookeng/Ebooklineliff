// SSOT Phase 082 §3.2/Gate 1 — Tax GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/tax/presentation/graphql/tax.resolver.ts
// - Query.myTaxCertificates / Query.myTaxSummary (authed self).
// - Mutation.calculateTax / Mutation.generateTaxCertificate /
//   Mutation.upsertTaxProfile.
// - Zero new deps.
import { Args, Field, Float, ID, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { CalculateTaxUseCase } from '../../application/use-cases/calculate-tax.use-case';
import { Generate50TawiPdfUseCase } from '../../application/use-cases/generate-50-tawi-pdf.use-case';
import type { TaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';
import { PrismaTaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';

@ObjectType('TaxCalculationPayload')
class TaxCalculationPayloadGql {
  @Field(() => ID) payoutRequestId!: string;
  @Field(() => Float) grossAmount!: number;
  @Field(() => Float) taxRate!: number;
  @Field(() => Float) taxWithheld!: number;
  @Field(() => Float) netAmount!: number;
  @Field() isExempt!: boolean;
  @Field(() => [String]) anomalies!: string[];
}

@ObjectType('TaxCertificatePayload')
class TaxCertificatePayloadGql {
  @Field(() => ID) certificateId!: string;
  @Field() certificateNo!: string;
  @Field() downloadUrl!: string;
  @Field(() => Int) downloadExpiresInSec!: number;
  @Field(() => Int) pdfBytes!: number;
  @Field(() => Int) tookMs!: number;
}

@ObjectType('TaxProfilePayload')
class TaxProfilePayloadGql {
  @Field(() => ID) id!: string;
  @Field() payerType!: string;
  @Field() taxId!: string;
  @Field() fullNameOrCompanyName!: string;
  @Field() address!: string;
  @Field() isTaxExempt!: boolean;
}

@ObjectType('TaxSummaryPayload')
class TaxSummaryPayloadGql {
  @Field(() => Int) year!: number;
  @Field(() => Float) gross!: number;
  @Field(() => Float) tax!: number;
  @Field(() => Int) count!: number;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing tax context');
  return { userId: user.id, tenantId };
}

@Resolver('Tax')
export class TaxResolver {
  constructor(
    private readonly calculate: CalculateTaxUseCase,
    private readonly generate: Generate50TawiPdfUseCase,
    private readonly repo: PrismaTaxRepository,
  ) {}

  @Query('myTaxCertificates')
  myTaxCertificates(
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const { userId } = ctxOf(ctx);
    return this.repo.listCertificates(userId, Math.min(limit || 20, 100));
  }

  @Query('myTaxSummary')
  async myTaxSummary(
    @Args('year', { nullable: true }) year: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const { userId } = ctxOf(ctx);
    const y = year || new Date().getFullYear();
    const s = await (this.repo as TaxRepository).annualSummary(userId, y);
    return { year: y, ...s };
  }

  @Mutation('calculateTax')
  calculateTax(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.calculate.execute({ tenantId: c.tenantId, actorUserId: c.userId, body: input });
  }

  @Mutation('generateTaxCertificate')
  generateTaxCertificate(
    @Args('grossAmount') grossAmount: number,
    @Args('incomeType', { nullable: true }) incomeType: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    if (!(grossAmount > 0)) throw new BadRequestException('Gross amount must be positive');
    return this.generate.execute({
      tenantId: c.tenantId,
      actorUserId: c.userId,
      grossAmount,
      incomeType: incomeType ?? 'CREATOR_SHARE_40_8',
    });
  }

  @Mutation('upsertTaxProfile')
  upsertTaxProfile(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const { userId } = ctxOf(ctx);
    const b = input as {
      payerType?: string; taxId?: string; fullNameOrCompanyName?: string;
      branchCode?: string; address?: string; isTaxExempt?: boolean;
    };
    if (!b.taxId || !b.fullNameOrCompanyName || !b.address) {
      throw new BadRequestException('Tax profile needs taxId, name and address');
    }
    const repo: TaxRepository = this.repo;
    return repo.upsertProfile({
      userId,
      payerType: b.payerType ?? 'INDIVIDUAL',
      taxId: b.taxId,
      fullNameOrCompanyName: b.fullNameOrCompanyName,
      branchCode: b.branchCode ?? '00000',
      address: b.address,
      isTaxExempt: b.isTaxExempt ?? false,
    });
  }
}
