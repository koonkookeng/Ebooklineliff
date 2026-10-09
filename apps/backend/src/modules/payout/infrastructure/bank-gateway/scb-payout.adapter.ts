// SSOT Phase 086 §5.1 — Bank gateway adapters (staged transport)
// Canonical: apps/backend/src/modules/payout/infrastructure/bank-gateway/scb-payout.adapter.ts
// - Same staged-transport contract as the Kasikorn adapter (see its header).
//   Factory selection: KBANK accounts ride Kasikorn, everything else SCB.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { signBankPayload } from '@repo/shared';
import type { BankGatewayPort } from '../../application/use-cases/process-batch-clearing.use-case';

@Injectable()
export class ScbPayoutAdapter implements BankGatewayPort {
  readonly bankCode = 'SCB';
  private readonly logger = new Logger(ScbPayoutAdapter.name);

  constructor(private readonly secret: string = process.env['BANK_CALLBACK_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz') {}

  async stageBatch(args: {
    batchNo: string;
    items: Array<{ payoutId: string; bankName: string; bankAccountNumber: string; bankAccountName: string; netAmount: number }>;
  }): Promise<{ transRef: string; accepted: boolean }> {
    const transRef = `SCB-${args.batchNo}`;
    const envelope = signBankPayload(this.secret, { payoutId: args.items[0]?.payoutId ?? args.batchNo, transRef });
    this.logger.log(`SCB batch staged: ${args.batchNo} (${args.items.length} items, envelope ${envelope.slice(0, 12)}…)`);
    return { transRef, accepted: true };
  }
}
