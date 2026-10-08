// SSOT Phase 081 BDD-2/Task 5 — Payout request engine (locked, taxed, recorded)
// Canonical: apps/backend/src/modules/finance/application/payout.service.ts
// - Flow: Zod gate (100 THB floor) -> Redis payout mutex (fail-closed, BDD-2
//   double-withdrawal guard) -> cover check against ledger balance ->
//   ONE $transaction: balance debit + PayoutTransaction(REQUESTED) +
//   WithholdingTaxRecord -> mutex release -> wallet broadcast + payout event.
// - approvePayout: admin-only status flip (REQUESTED → PROCESSING_BANK;
//   bank settlement itself lands in 086 — this module never fakes transfers).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  FinancePayoutRequestSchema,
  FINANCE_PAYOUT_STREAM,
  financePayoutNo,
  withholdingSplit,
} from '@repo/shared';
import { PAYOUT_REQUESTED_EVENT, PAYOUT_APPROVED_EVENT } from '../domain/events/payout-requested.event';
import type { LedgerRepository } from '../infrastructure/prisma-ledger.repository';
import type { BalanceCachePort } from '../infrastructure/redis-balance.cache';
import type { TaxCalculatorService } from './tax-calculator.service';

export interface PayoutTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class FinancePayoutService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly cache: BalanceCachePort,
    private readonly tx: PayoutTx,
    private readonly tax: TaxCalculatorService,
  ) {}

  async requestPayout(args: {
    tenantId: string;
    actorUserId: string;
    body: unknown;
    bankSnapshot: { bankName: string; accountNumber: string; accountName: string };
    identity: { taxId: string; payeeName: string; payeeAddress: string };
  }): Promise<{ payoutId: string; grossAmount: number; taxAmount: number; netAmount: number; status: string }> {
    const parsed = FinancePayoutRequestSchema.safeParse({
      ...((args.body ?? {}) as Record<string, unknown>),
      tenantId: args.tenantId,
      userId: args.actorUserId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid payout request');

    const locked = await this.cache.acquirePayoutLock(args.actorUserId);
    if (!locked) throw new ConflictException('A payout for this account is already processing');
    try {
      const balance = await this.repo.userBalance(args.actorUserId);
      if (parsed.data.requestedAmount > balance) {
        throw new BadRequestException(`Insufficient withdrawable balance (available ${balance})`);
      }
      const { tax, net } = withholdingSplit(parsed.data.requestedAmount);

      const payoutId = await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        await repo.adjustUserBalance(args.actorUserId, -parsed.data.requestedAmount);
        const row = await repo.createPayout({
          payoutNo: financePayoutNo(args.tenantId),
          userId: args.actorUserId,
          grossAmount: parsed.data.requestedAmount,
          taxRatePercent: 3,
          taxWithheldAmount: tax,
          netTransferAmount: net,
          bankAccountDetail: { ...args.bankSnapshot, bankAccountId: parsed.data.bankAccountId },
        });
        await repo.createTaxRecord({
          payoutTransactionId: row.id,
          taxCertificateNo: `${financePayoutNo(args.tenantId)}-T`,
          taxId: args.identity.taxId,
          payeeName: args.identity.payeeName,
          payeeAddress: args.identity.payeeAddress,
          grossAmount: parsed.data.requestedAmount,
          taxAmount: tax,
          pdfStoragePathR2: `tenants/${args.tenantId}/tax/${row.id}.pdf`,
        });
        return row.id;
      });

      await this.cache.emit(FINANCE_PAYOUT_STREAM, {
        event: PAYOUT_REQUESTED_EVENT,
        payoutId,
        userId: args.actorUserId,
        grossAmount: parsed.data.requestedAmount,
        netTransferAmount: net,
        at: Date.now(),
      });
      await this.cache.broadcastBalance(args.actorUserId, await this.repo.userBalance(args.actorUserId));
      return { payoutId, grossAmount: parsed.data.requestedAmount, taxAmount: tax, netAmount: net, status: 'REQUESTED' };
    } finally {
      await this.cache.releasePayoutLock(args.actorUserId);
    }
  }

  async approvePayout(payoutId: string, isAdmin: boolean): Promise<{ payoutId: string; status: string }> {
    if (!isAdmin) throw new ForbiddenException('Payout approval requires admin role');
    const row = await this.repo.findPayout(payoutId);
    if (!row) throw new BadRequestException('Payout not found');
    if (row.status !== 'REQUESTED') throw new ConflictException(`Payout is already ${row.status}`);
    await this.repo.markPayoutStatus(payoutId, 'PROCESSING_BANK');
    await this.cache.emit(FINANCE_PAYOUT_STREAM, {
      event: PAYOUT_APPROVED_EVENT,
      payoutId,
      userId: row.userId,
      grossAmount: row.grossAmount,
      netTransferAmount: row.netTransferAmount,
      at: Date.now(),
    });
    return { payoutId, status: 'PROCESSING_BANK' };
  }
}
