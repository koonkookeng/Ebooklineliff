// SSOT Phase 081 Task 8 — Balance aggregator + daily reconciliation probe
// Canonical: apps/backend/src/modules/finance/application/balance-calculator.service.ts
// - overview: withdrawable (ledger balance) + pending escrow (0 in 081 —
//   escrow releases land in a later phase; reported honestly) + lifetime
//   earned + tax withheld (Gate 8 inputs).
// - statements: paginated double-entry history with running view + hasMore.
// - checkSystemWideDiscrepancy: Δ = Σdebits − Σcredits; nonzero Δ means the
//   cron must page the admin OA and pause payouts (§10.1; the controller
//   enforces the pause, this service only measures).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import type { LedgerRepository } from '../infrastructure/prisma-ledger.repository';
import type { BalanceCachePort } from '../infrastructure/redis-balance.cache';

@Injectable()
export class BalanceCalculatorService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly cache: BalanceCachePort,
  ) {}

  async overview(userId: string): Promise<{
    withdrawableBalance: number;
    pendingEscrowBalance: number;
    totalEarnedLifetime: number;
    totalCommissionPaid: number;
    taxWithheldLifetime: number;
  }> {
    const cached = await this.cache.readBalance(userId);
    const withdrawable = cached ?? (await this.repo.userBalance(userId));
    if (cached == null) await this.cache.writeBalance(userId, withdrawable);
    const lifetime = await this.repo.lifetimeTotals(userId);
    return {
      withdrawableBalance: withdrawable,
      pendingEscrowBalance: 0,
      totalEarnedLifetime: lifetime.earned,
      totalCommissionPaid: lifetime.commissionPaid,
      taxWithheldLifetime: lifetime.taxWithheld,
    };
  }

  async statements(userId: string, limit = 20, offset = 0): Promise<{
    items: Array<{
      id: string;
      createdAt: string;
      description: string;
      debitAmount: number;
      creditAmount: number;
      runningBalance: number;
      referenceOrderId: string | null;
    }>;
    totalCount: number;
    hasMore: boolean;
  }> {
    const page = await this.repo.statementPage({ userId, limit, offset });
    let running = await this.repo.userBalance(userId);
    const items = page.items.map((it) => {
      const row = {
        id: it.id,
        createdAt: it.createdAt.toISOString(),
        description: it.description,
        debitAmount: it.debit,
        creditAmount: it.credit,
        runningBalance: running,
        referenceOrderId: it.referenceOrderId,
      };
      running = Math.round((running - it.credit + it.debit) * 100) / 100;
      return row;
    });
    return { items, totalCount: page.totalCount, hasMore: offset + page.items.length < page.totalCount };
  }

  /** §10.1 probe: 0.0000 when the ledger is whole. */
  async checkSystemWideDiscrepancy(): Promise<number> {
    return this.repo.systemDiscrepancy();
  }
}
