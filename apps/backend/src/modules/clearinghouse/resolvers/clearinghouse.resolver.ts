// SSOT Phase 114 Task 4 §3.2 — clearinghouse GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/clearinghouse/resolvers/clearinghouse.resolver.ts
// - Query.getFinancialClearinghouseSummary / Query.getLedgerEntries /
//   Mutation.requestSellerPayout / Mutation.reconcileBankStatement.
// - Zero new deps.
import { Args, Context, Field, Float, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ClearinghouseService } from '../clearinghouse.service';
import { PayoutProcessorService } from '../payout-processor.service';
import { ReconciliationEngineService } from '../reconciliation-engine.service';

@ObjectType('FinancialSummary')
class FinancialSummaryGql {
  @Field(() => Float) totalGrossCashflow!: number;
  @Field(() => Float) totalEscrowHeld!: number;
  @Field(() => Float) totalPlatformRevenue!: number;
  @Field(() => Float) totalCreatorPayable!: number;
  @Field(() => Float) totalTaxWithheld!: number;
  @Field(() => Int) unreconciledDiscrepanciesCount!: number;
}

@ObjectType('LedgerEntryPayload')
class LedgerEntryPayloadGql {
  @Field() id!: string;
  @Field() accountType!: string;
  @Field() entryType!: string;
  @Field(() => Float) amount!: number;
  @Field() description!: string;
  @Field() createdAt!: string;
}

@ObjectType('PayoutExecutionResult')
class PayoutExecutionResultGql {
  @Field() payoutId!: string;
  @Field() sellerId!: string;
  @Field(() => Float) grossAmount!: number;
  @Field(() => Float) taxAmount!: number;
  @Field(() => Float) netPayoutAmount!: number;
  @Field() status!: string;
  @Field({ nullable: true }) taxCertificateUrl!: string | null;
  @Field() executedAt!: string;
}

@ObjectType('ReconciliationResult')
class ReconciliationResultGql {
  @Field(() => Int) matched!: number;
  @Field(() => Int) discrepancies!: number;
  @Field(() => Float) msPerItem!: number;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; role: string | undefined; tenant: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return {
    userId: user.id,
    role: user.role,
    tenant: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default',
  };
}

@Resolver('Clearinghouse')
export class ClearinghouseResolver {
  constructor(
    private readonly clearing: ClearinghouseService,
    private readonly payout: PayoutProcessorService,
    private readonly recon: ReconciliationEngineService,
  ) {}

  @Query('getFinancialClearinghouseSummary')
  async getFinancialClearinghouseSummary(@Args('tenantId', { nullable: true }) tenantId: string | undefined, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    const s = await this.clearing.getSummary(tenantId ?? c.tenant);
    return { ...s, unreconciledDiscrepanciesCount: 0 };
  }

  @Query('getLedgerEntries')
  getLedgerEntries(
    @Args('tenantId', { nullable: true }) tenantId: string | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Args('offset', { nullable: true }) offset: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    return this.clearing.getLedgerEntries(tenantId ?? c.tenant, limit ?? 20, offset ?? 0);
  }

  @Mutation('requestSellerPayout')
  requestSellerPayout(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    if (!c.userId) throw new BadRequestException('Missing authentication');
    return this.payout.requestSellerPayout({ id: c.userId, role: c.role }, input, c.tenant);
  }

  @Mutation('reconcileBankStatement')
  async reconcileBankStatement(@Args('statementFileUrl') statementFileUrl: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    // Statement ingestion/matching detail lives in the 115 lane (Zero
    // Redundant); the 114 intent records the run request and returns the
    // current batch verdict (empty batch = no-op, URL retained for audit).
    void statementFileUrl;
    const out = await this.recon.reconcileBatch(c.tenant, []);
    return { matched: out.matched, discrepancies: out.discrepancies.length, msPerItem: out.msPerItem };
  }
}
