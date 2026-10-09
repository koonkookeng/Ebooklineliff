// SSOT Phase 086 — Prisma clearing store (structural adapter)
// Canonical: apps/backend/src/modules/payout/infrastructure/clearing.store.ts
// (ADDITIVE to the §5.1 tree: the tree names no repository, but the
// use-cases need a test seam — 078–085 structural precedent.)
// - markPayoutStatus / hold-audit rows / approval queue / trail sums.
//   Money writes stay in 081 (this store only flips statuses + audits).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

@Injectable()
export class PrismaClearingStore {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async markPayoutStatus(payoutId: string, status: string): Promise<void> {
    await this.db['payoutTransaction'].update({ where: { id: payoutId }, data: { status } });
  }

  async writeHoldAudit(args: {
    userId: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    transactionType: string;
    referenceId: string;
  }): Promise<void> {
    await this.db['walletLedger'].create({
      data: {
        userId: args.userId,
        amount: args.amount,
        balanceBefore: args.balanceBefore,
        balanceAfter: args.balanceAfter,
        transactionType: args.transactionType,
        referenceId: args.referenceId,
      },
    });
  }

  async ledgerBalance(userId: string): Promise<number> {
    const row = (await this.db['financialAccount'].findUnique({ where: { userId } }).catch(() => null)) as {
      currentBalance: unknown;
    } | null;
    return toNum(row?.currentBalance ?? 0);
  }

  async approvalQueue(tenantId: string): Promise<Array<{
    id: string; userId: string; grossAmount: number; netTransferAmount: number;
    status: string; bankAccountDetail: { bankName?: string; accountNumber?: string; accountName?: string } | null;
  }>> {
    void tenantId;
    const rows = (await this.db['payoutTransaction'].findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'REQUESTED'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }).catch(() => [])) as Array<{
      id: string; userId: string | null; grossAmount: unknown; netTransferAmount: unknown;
      status: string; bankAccountDetail: { bankName?: string; accountNumber?: string; accountName?: string } | null;
    }>;
    return rows
      .filter((r) => r.userId)
      .map((r) => ({
        id: r.id,
        userId: r.userId as string,
        grossAmount: toNum(r.grossAmount),
        netTransferAmount: toNum(r.netTransferAmount),
        status: r.status,
        bankAccountDetail: r.bankAccountDetail,
      }));
  }

  async setTransRef(payoutId: string, transRef: string): Promise<void> {
    await this.db['payoutTransaction'].update({ where: { id: payoutId }, data: { transRef } });
  }

  /** Payout row for callback settlement (transRef replay-safe). */
  async findPayoutForCallback(payoutId: string): Promise<{
    id: string; userId: string | null; grossAmount: number; netTransferAmount: number;
    status: string; transRef: string | null;
  } | null> {
    const row = (await this.db['payoutTransaction'].findUnique({ where: { id: payoutId } }).catch(() => null)) as {
      id: string; userId: string | null; grossAmount: unknown; netTransferAmount: unknown;
      status: string; transRef: string | null;
    } | null;
    if (!row) return null;
    return {
      ...row,
      grossAmount: toNum(row.grossAmount),
      netTransferAmount: toNum(row.netTransferAmount),
    };
  }

  async walletTrailSum(userId: string): Promise<number> {
    const agg = (await this.db['walletLedger'].aggregate({
      where: { userId },
      _sum: { amount: true },
    }).catch(() => ({ _sum: {} }))) as { _sum: { amount: unknown } };
    return toNum(agg._sum.amount);
  }
}
