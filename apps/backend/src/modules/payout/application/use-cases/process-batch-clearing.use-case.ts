// SSOT Phase 086 BDD-2 — Batch clearing dispatcher (approve → bank stage)
// Canonical: apps/backend/src/modules/payout/application/use-cases/process-batch-clearing.use-case.ts
// - Flow (admin): PENDING_APPROVAL/REQUESTED queue → per-item approve
//   (081 flip → PROCESSING_BANK) → HMAC-signed bank payload via the
//   per-bank adapter → clearing stream. Transport plugs in with credentials;
//   until then the adapter stages (status stays PROCESSING_BANK for the real
//   bank callback — never faked SUCCESS).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PAYOUT_CLEARING_STREAM, clearingBatchNo } from '@repo/shared';
import { FinancePayoutService } from '../../../finance/application/payout.service';

export interface BankGatewayPort {
  bankCode: string;
  stageBatch(args: {
    batchNo: string;
    items: Array<{ payoutId: string; bankName: string; bankAccountNumber: string; bankAccountName: string; netAmount: number }>;
  }): Promise<{ transRef: string; accepted: boolean }>;
}

export interface ClearingAdminStore {
  approvalQueue(tenantId: string): Promise<Array<{
    id: string; userId: string; grossAmount: number; netTransferAmount: number;
    status: string; bankAccountDetail: { bankName?: string; accountNumber?: string; accountName?: string } | null;
  }>>;
  setTransRef(payoutId: string, transRef: string): Promise<void>;
}

export interface ClearingAdminBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

@Injectable()
export class ProcessBatchClearingUseCase {
  constructor(
    private readonly finance: FinancePayoutService,
    private readonly store: ClearingAdminStore,
    private readonly gateway: BankGatewayPort,
    private readonly bus: ClearingAdminBus,
  ) {}

  async approveBatch(args: {
    tenantId: string;
    actorUserId: string;
    actorRole?: string;
    payoutIds: string[];
  }): Promise<{ batchNo: string; cleared: string[]; transRef: string }> {
    if (!args.actorRole || !ADMIN_ROLES.has(args.actorRole)) {
      throw new BadRequestException('Batch clearing requires a finance admin role');
    }
    if (args.payoutIds.length === 0) throw new BadRequestException('Empty batch');
    if (args.payoutIds.length > 100) throw new BadRequestException('Batch exceeds 100 items');

    const queue = await this.store.approvalQueue(args.tenantId);
    const queued = new Map(queue.map((q) => [q.id, q]));
    const items = args.payoutIds.map((id) => {
      const row = queued.get(id);
      if (!row) throw new BadRequestException(`Payout ${id} is not awaiting approval`);
      return row;
    });

    const batchNo = clearingBatchNo(args.tenantId);
    for (const item of items) {
      await this.finance.approvePayout(item.id, true);
    }
    const dispatch = await this.gateway.stageBatch({
      batchNo,
      items: items.map((i) => ({
        payoutId: i.id,
        bankName: i.bankAccountDetail?.bankName ?? '',
        bankAccountNumber: i.bankAccountDetail?.accountNumber ?? '',
        bankAccountName: i.bankAccountDetail?.accountName ?? '',
        netAmount: i.netTransferAmount,
      })),
    });
    for (const item of items) {
      await this.store.setTransRef(item.id, dispatch.transRef);
    }

    await this.bus
      .xadd(PAYOUT_CLEARING_STREAM, {
        event: 'payout.batch.staged',
        batchNo,
        count: items.length,
        transRef: dispatch.transRef,
        at: Date.now(),
      })
      .catch(() => undefined);
    return { batchNo, cleared: items.map((i) => i.id), transRef: dispatch.transRef };
  }
}
