// SSOT Phase 081 §3.2/Gate 1 — Finance GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/finance/presentation/finance.resolver.ts
// - Query.getFinancialOverview / Query.getLedgerStatements (authed self).
// - Mutation.requestPayout(amount, bankAccountId) / Mutation.approvePayout.
// - RISK_CALL (documented): payload type names are Finance*-prefixed —
//   PayoutResponsePayload is owned by the affiliate module (079); a second
//   declaration would collide the schema (080 precedent).
// - Zero new deps.
import { Args, Field, Float, ID, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BalanceCalculatorService } from '../application/balance-calculator.service';
import { FinancePayoutService } from '../application/payout.service';

@ObjectType('FinancialSummaryPayload')
class FinancialSummaryPayloadGql {
  @Field(() => Float) withdrawableBalance!: number;
  @Field(() => Float) pendingEscrowBalance!: number;
  @Field(() => Float) totalEarnedLifetime!: number;
  @Field(() => Float) totalCommissionPaid!: number;
  @Field(() => Float) taxWithheldLifetime!: number;
}

@ObjectType('LedgerStatementItem')
class LedgerStatementItemGql {
  @Field(() => ID) id!: string;
  @Field() createdAt!: string;
  @Field() description!: string;
  @Field(() => Float, { nullable: true }) debitAmount!: number | null;
  @Field(() => Float, { nullable: true }) creditAmount!: number | null;
  @Field(() => Float) runningBalance!: number;
  @Field({ nullable: true }) referenceOrderId!: string | null;
}

@ObjectType('LedgerStatementConnection')
class LedgerStatementConnectionGql {
  @Field(() => [LedgerStatementItemGql]) items!: LedgerStatementItemGql[];
  @Field(() => Int) totalCount!: number;
  @Field() hasMore!: boolean;
}

@ObjectType('FinancePayoutResponsePayload')
class FinancePayoutResponsePayloadGql {
  @Field() success!: boolean;
  @Field(() => ID) payoutId!: string;
  @Field(() => Float) grossAmount!: number;
  @Field(() => Float) taxAmount!: number;
  @Field(() => Float) netAmount!: number;
  @Field() estimatedTransferTime!: string;
}

@ObjectType('FinancePayoutApprovalPayload')
class FinancePayoutApprovalPayloadGql {
  @Field(() => ID) payoutId!: string;
  @Field() status!: string;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; tenantId: string; role?: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing finance context');
  return { userId: user.id, tenantId, ...(user.role ? { role: user.role } : {}) };
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

@Resolver('Finance')
export class FinanceResolver {
  constructor(
    private readonly balances: BalanceCalculatorService,
    private readonly payouts: FinancePayoutService,
  ) {}

  @Query('getFinancialOverview')
  getFinancialOverview(@Context() ctx: LooseCtx) {
    return this.balances.overview(ctxOf(ctx).userId);
  }

  @Query('getLedgerStatements')
  getLedgerStatements(
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Args('offset', { nullable: true }) offset: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    return this.balances.statements(
      ctxOf(ctx).userId,
      Math.min(limit || 20, 100),
      Math.max(offset || 0, 0),
    );
  }

  @Mutation('requestPayout')
  async requestPayout(
    @Args('amount') amount: number,
    @Args('bankAccountId') bankAccountId: string,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    const r = await this.payouts.requestPayout({
      tenantId: c.tenantId,
      actorUserId: c.userId,
      body: { userId: c.userId, requestedAmount: amount, bankAccountId },
      bankSnapshot: { bankName: '', accountNumber: '', accountName: '' },
      identity: { taxId: '', payeeName: '', payeeAddress: '' },
    });
    return {
      success: true,
      payoutId: r.payoutId,
      grossAmount: r.grossAmount,
      taxAmount: r.taxAmount,
      netAmount: r.netAmount,
      estimatedTransferTime: '1-2 business days',
    };
  }

  @Mutation('approvePayout')
  approvePayout(@Args('payoutId') payoutId: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    if (!c.role || !ADMIN_ROLES.has(c.role)) {
      throw new ForbiddenException('Payout approval requires admin role');
    }
    return this.payouts.approvePayout(payoutId, true);
  }
}
