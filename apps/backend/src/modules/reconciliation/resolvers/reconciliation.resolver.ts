// SSOT Phase 115 Task 2 §3.2 — reconciliation GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/reconciliation/resolvers/reconciliation.resolver.ts
// - Query.getReconciliationKPI / Query.listBankStatements /
//   Mutation.reconcileBankStatement / Mutation.executeManualOverride /
//   Mutation.approveOverrideChecker.
// - Zero new deps.
import { Args, Context, Field, Float, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { autoMatchRate } from '@repo/shared';
import { AutoReconciliationEngineService } from '../services/auto-reconciliation-engine.service';
import { ManualOverrideService } from '../services/manual-override.service';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';

@ObjectType('BankStatementNode')
class BankStatementNodeGql {
  @Field() id!: string;
  @Field() bankCode!: string;
  @Field() accountNumber!: string;
  @Field({ nullable: true }) transRef!: string | null;
  @Field(() => Float) amount!: number;
  @Field() txType!: string;
  @Field() txTimestamp!: string;
  @Field({ nullable: true }) senderName!: string | null;
  @Field() status!: string;
  @Field({ nullable: true }) matchedOrderId!: string | null;
  @Field({ nullable: true }) matchedOrderNumber!: string | null;
  @Field({ nullable: true }) mismatchReason!: string | null;
  @Field() createdAt!: string;
}

@ObjectType('ReconciliationSummaryKPI')
class ReconciliationSummaryKPIGql {
  @Field(() => Int) totalStatementsCount!: number;
  @Field(() => Float) autoMatchedRatePercentage!: number;
  @Field(() => Float) totalMatchedAmount!: number;
  @Field(() => Int) pendingDiscrepanciesCount!: number;
  @Field(() => Int) manualOverriddenCount!: number;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; role?: string; ip: string; ua: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    userId: user.id,
    ...(user.role ? { role: user.role } : {}),
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
  };
}

function toNode(row: Record<string, unknown>): BankStatementNodeGql {
  const out = new BankStatementNodeGql();
  out.id = String(row['id'] ?? '');
  out.bankCode = String((row['bankAccount'] as { bankCode?: string } | undefined)?.bankCode ?? row['bankCode'] ?? '');
  out.accountNumber = String((row['bankAccount'] as { accountNumber?: string } | undefined)?.accountNumber ?? row['accountNumber'] ?? '');
  out.transRef = (row['transRef'] as string | null | undefined) ?? null;
  out.amount = Number(row['amount'] ?? 0);
  out.txType = String(row['txType'] ?? 'CREDIT');
  out.txTimestamp = row['txTimestamp'] instanceof Date ? (row['txTimestamp'] as Date).toISOString() : String(row['txTimestamp'] ?? '');
  out.senderName = (row['senderName'] as string | null | undefined) ?? null;
  out.status = String(row['status'] ?? '');
  out.matchedOrderId = (row['matchedOrderId'] as string | null | undefined) ?? null;
  out.matchedOrderNumber = String((row['matchedOrder'] as { orderNumber?: string } | undefined)?.orderNumber ?? '');
  out.mismatchReason = (row['mismatchReason'] as string | null | undefined) ?? null;
  out.createdAt = row['createdAt'] instanceof Date ? (row['createdAt'] as Date).toISOString() : String(row['createdAt'] ?? '');
  return out;
}

@Resolver('Reconciliation')
export class ReconciliationResolver {
  constructor(
    private readonly engine: AutoReconciliationEngineService,
    private readonly overrides: ManualOverrideService,
    private readonly repo: ReconciliationRepository,
  ) {}

  @Query('getReconciliationKPI')
  async getReconciliationKPI(
    @Args('tenantId') _tenantId: string,
    @Args('startDate') _startDate: string,
    @Args('endDate') _endDate: string,
  ) {
    const counts = await this.repo.kpiCounts();
    return {
      totalStatementsCount: counts.total,
      autoMatchedRatePercentage: autoMatchRate(counts.auto, counts.total),
      totalMatchedAmount: 0,
      pendingDiscrepanciesCount: counts.pending,
      manualOverriddenCount: counts.overridden,
    };
  }

  @Query('listBankStatements')
  async listBankStatements(
    @Args('status', { nullable: true }) status: string | undefined,
    @Args('page', { nullable: true }) page: number | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
  ) {
    const p = Math.max(1, page ?? 1);
    const l = Math.min(100, Math.max(1, limit ?? 50));
    const rows = (await this.repo.listStatements({ status, skip: (p - 1) * l, take: l })) as Record<string, unknown>[];
    return rows.map(toNode);
  }

  @Mutation('reconcileBankStatement')
  reconcileBankStatement(@Args('statementId') statementId: string) {
    if (!statementId) throw new BadRequestException('Missing statementId');
    return this.repo.statementById(statementId).then((row) => {
      if (!row) throw new BadRequestException('Statement not found');
      return toNode(row as Record<string, unknown>);
    });
  }

  @Mutation('executeManualOverride')
  async executeManualOverride(
    @Args('statementId') statementId: string,
    @Args('orderId') orderId: string,
    @Args('reason') reason: string,
    @Args('note', { nullable: true }) note: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    // Spec-shape: returns the statement node post-initiate. The full
    // override envelope (overrideId/needsChecker) rides the REST lane
    // (POST /api/v1/admin/reconciliation/initiate) — dual transport.
    const c = ctxOf(ctx);
    if (!c.userId) throw new BadRequestException('Missing authentication');
    await this.overrides.initiateOverride(
      { id: c.userId, role: c.role },
      { statementId, orderId, overrideReason: reason, ...(note ? { adjustmentNote: note } : {}) },
      { ipAddress: c.ip, userAgent: c.ua },
    );
    const row = (await this.repo.statementById(statementId).catch(() => null)) as Record<string, unknown> | null;
    if (!row) throw new BadRequestException('Statement not found');
    return toNode(row);
  }

  @Mutation('approveOverrideChecker')
  approveOverrideChecker(@Args('overrideLogId') overrideLogId: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    if (!c.userId) throw new BadRequestException('Missing authentication');
    return this.overrides.approveOverrideChecker({ id: c.userId, role: c.role }, overrideLogId, { ipAddress: c.ip, userAgent: c.ua });
  }
}
