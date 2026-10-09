// SSOT Phase 086 Task 9/Gate 7 — Ledger integrity probe (delegated math)
// Canonical: apps/backend/src/modules/payout/domain/services/ledger-integrity.service.ts
// - checkIntegrity: finance double-entry Δ (081 probe) + WalletLedger trail
//   sum per user. Rollback/alert decisions belong to the caller (finance
//   reconcile); this service only measures (single-source math).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { BalanceCalculatorService } from '../../../finance/application/balance-calculator.service';

export interface ClearingLedgerPort {
  walletTrailSum(userId: string): Promise<number>;
}

@Injectable()
export class LedgerIntegrityService {
  constructor(
    private readonly balances: BalanceCalculatorService,
    private readonly trail: ClearingLedgerPort,
  ) {}

  async checkIntegrity(userId: string): Promise<{
    systemDelta: number;
    walletTrailSum: number;
    healthy: boolean;
  }> {
    const [systemDelta, trailSum] = await Promise.all([
      this.balances.checkSystemWideDiscrepancy(),
      this.trail.walletTrailSum(userId),
    ]);
    return { systemDelta, walletTrailSum: trailSum, healthy: systemDelta === 0 };
  }
}
