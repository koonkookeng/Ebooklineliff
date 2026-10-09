// SSOT Phase 086 BDD-1/Task 3 — KYC-gated payout request (delegated hold)
// Canonical: apps/backend/src/modules/payout/application/use-cases/request-payout.use-case.ts
// - Flow: Zod gate (100 THB floor) -> e-KYC VERIFIED gate (085 tables,
//   read-only) -> delegate hold+debit+REQUESTED to FinancePayoutService
//   (081 single writer — no duplicate ledger code) -> flip to
//   PENDING_APPROVAL (BDD-1 name) -> WalletLedger PAYOUT_LOCK audit row ->
//   clearing stream.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PAYOUT_CLEARING_STREAM, PayoutRequestPayloadSchema } from '@repo/shared';
import { FinancePayoutService } from '../../../finance/application/payout.service';

export interface KycGatePort {
  /** Verified creator profile + bank snapshot, or null. */
  verifiedPayoutProfile(userId: string): Promise<{
    bankName: string;
    accountNumber: string;
    accountName: string;
    taxId: string;
    payeeName: string;
    payeeAddress: string;
  } | null>;
}

export interface ClearingBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface ClearingStore {
  markPayoutStatus(payoutId: string, status: string): Promise<void>;
  writeHoldAudit(args: {
    userId: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    transactionType: string;
    referenceId: string;
  }): Promise<void>;
  ledgerBalance(userId: string): Promise<number>;
}

export interface ClearingTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class RequestPayoutUseCase {
  constructor(
    private readonly finance: FinancePayoutService,
    private readonly kyc: KycGatePort,
    private readonly store: ClearingStore,
    private readonly tx: ClearingTx,
    private readonly bus: ClearingBus,
  ) {}

  async execute(args: {
    tenantId: string;
    actorUserId: string;
    body: unknown;
    net: { ipAddress: string };
  }): Promise<{
    success: boolean;
    payoutId: string;
    grossAmount: number;
    taxAmount: number;
    netAmount: number;
    status: string;
  }> {
    const parsed = PayoutRequestPayloadSchema.safeParse({
      ...((args.body ?? {}) as Record<string, unknown>),
      tenantId: args.tenantId,
    });
    if (!parsed.success) throw new BadRequestException('ขั้นต่ำในการถอนคือ 100 บาท');

    const profile = await this.kyc.verifiedPayoutProfile(args.actorUserId);
    if (!profile) {
      throw new BadRequestException('ไม่พบข้อมูลการยืนยันตัวตน (e-KYC) หรือ e-KYC ยังไม่ผ่านการอนุมัติ');
    }

    const created = await this.finance.requestPayout({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      body: {
        tenantId: args.tenantId,
        amount: parsed.data.amount,
        bankName: profile.bankName,
        bankAccountNumber: profile.accountNumber,
        bankAccountName: profile.accountName,
      },
      bankSnapshot: {
        bankName: profile.bankName,
        accountNumber: profile.accountNumber,
        accountName: profile.accountName,
      },
      identity: { taxId: profile.taxId, payeeName: profile.payeeName, payeeAddress: profile.payeeAddress },
    });

    await this.tx.run(async () => {
      await this.store.markPayoutStatus(created.payoutId, 'PENDING_APPROVAL');
      const after = await this.store.ledgerBalance(args.actorUserId);
      await this.store.writeHoldAudit({
        userId: args.actorUserId,
        amount: -created.grossAmount,
        balanceBefore: after + created.grossAmount,
        balanceAfter: after,
        transactionType: 'PAYOUT_LOCK',
        referenceId: created.payoutId,
      });
    });

    await this.bus
      .xadd(PAYOUT_CLEARING_STREAM, {
        event: 'payout.requested',
        payoutId: created.payoutId,
        userId: args.actorUserId,
        grossAmount: created.grossAmount,
        ip: args.net.ipAddress,
        at: Date.now(),
      })
      .catch(() => undefined);

    return {
      success: true,
      payoutId: created.payoutId,
      grossAmount: created.grossAmount,
      taxAmount: created.taxAmount,
      netAmount: created.netAmount,
      status: 'PENDING_APPROVAL',
    };
  }
}
