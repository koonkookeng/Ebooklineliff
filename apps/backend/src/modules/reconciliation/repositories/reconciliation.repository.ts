// SSOT Phase 115 Task 1 §5.1 — reconciliation structural repository
// Canonical: apps/backend/src/modules/reconciliation/repositories/reconciliation.repository.ts
// (legacy src/backend/modules/reconciliation/repositories/reconciliation.repository.ts)
// - Thin Prisma adapter (statements/accounts/logs/overrides/slips/orders).
//   Services stay mock-friendly through this single seam (085 store precedent).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

type PrismaAny = {
  bankAccountConfig: { findFirst(a: unknown): Promise<unknown> };
  bankStatement: {
    findFirst(a: unknown): Promise<unknown>;
    findUnique(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    count(a: unknown): Promise<number>;
  };
  reconciliationLog: { create(a: unknown): Promise<unknown> };
  financialManualOverride: {
    findUnique(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
  };
  paymentSlip: { findUnique(a: unknown): Promise<unknown>; findMany(a: unknown): Promise<unknown[]> };
  order: { findUnique(a: unknown): Promise<unknown>; findMany(a: unknown): Promise<unknown[]> };
};

@Injectable()
export class ReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  accountByNumber(accountNumber: string): Promise<unknown> {
    return this.db.bankAccountConfig.findFirst({ where: { accountNumber } });
  }

  statementByHash(hashSign: string): Promise<unknown> {
    return this.db.bankStatement.findFirst({ where: { hashSign } });
  }

  statementById(id: string): Promise<unknown> {
    return this.db.bankStatement.findUnique({ where: { id } });
  }

  slipByTransRef(transRef: string): Promise<unknown> {
    return this.db.paymentSlip.findUnique({ where: { transRef }, include: { order: true } });
  }

  verifiedSlipRefs(transRefs: string[]): Promise<string[]> {
    if (transRefs.length === 0) return Promise.resolve([]);
    return (this.db.paymentSlip.findMany({
      where: { transRef: { in: transRefs }, verifiedAt: { not: null } },
      select: { transRef: true },
    }) as Promise<Array<{ transRef: string | null }>>).then((rows) =>
      rows.map((r) => r.transRef).filter((t): t is string => !!t),
    );
  }

  pendingOrdersByAmountNet(amount: number): Promise<unknown[]> {
    return this.db.order.findMany({ where: { orderStatus: 'PENDING_PAYMENT', netAmount: amount } });
  }

  orderById(id: string): Promise<unknown> {
    return this.db.order.findUnique({ where: { id }, include: { orderItems: true } });
  }

  recentStatementsBySender(senderName: string | null, take = 20): Promise<unknown[]> {
    return this.db.bankStatement.findMany({
      where: { senderName: senderName ?? undefined, txType: 'CREDIT' },
      orderBy: { txTimestamp: 'desc' },
      take,
    });
  }

  appendLog(data: Record<string, unknown>): Promise<unknown> {
    return (this.db as unknown as { reconciliationLog: { create(a: unknown): Promise<unknown> } }).reconciliationLog.create({ data });
  }

  overrideById(id: string): Promise<unknown> {
    return this.db.financialManualOverride.findUnique({ where: { id } });
  }

  listStatements(args: { status?: string; skip: number; take: number }): Promise<unknown[]> {
    return this.db.bankStatement.findMany({
      where: args.status ? { status: args.status } : {},
      orderBy: { txTimestamp: 'desc' },
      skip: args.skip,
      take: args.take,
    });
  }

  countStatements(status?: string): Promise<number> {
    return this.db.bankStatement.count({ where: status ? { status } : {} });
  }

  kpiCounts(): Promise<{ total: number; auto: number; pending: number; overridden: number }> {
    return Promise.all([
      this.db.bankStatement.count({}),
      this.db.bankStatement.count({ where: { status: 'AUTO_MATCHED' } }),
      this.db.bankStatement.count({ where: { status: { in: ['UNMATCHED', 'DISCREPANCY_FLAGGED'] } } }),
      this.db.bankStatement.count({ where: { status: 'MANUAL_OVERRIDDEN' } }),
    ]).then(([total, auto, pending, overridden]) => ({ total, auto, pending, overridden }));
  }
}
