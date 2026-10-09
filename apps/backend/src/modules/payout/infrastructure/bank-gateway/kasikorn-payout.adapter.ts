// SSOT Phase 086 §5.1 — Bank gateway adapters (staged transport)
// Canonical: apps/backend/src/modules/payout/infrastructure/bank-gateway/kasikorn-payout.adapter.ts
// - RISK_CALL (documented): no bank credentials exist in this repo, so the
//   adapter STAGES the HMAC-signed batch (returns transRef, emits event)
//   and the payout stays PROCESSING_BANK until the real bank callback
//   webhook arrives. SUCCESS is never fabricated. Transport plugs in here.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { signBankPayload } from '@repo/shared';
import type { BankGatewayPort } from '../../application/use-cases/process-batch-clearing.use-case';

@Injectable()
export class KasikornPayoutAdapter implements BankGatewayPort {
  readonly bankCode = 'KBANK';
  private readonly logger = new Logger(KasikornPayoutAdapter.name);

  constructor(private readonly secret: string = process.env['BANK_CALLBACK_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz') {}

  async stageBatch(args: {
    batchNo: string;
    items: Array<{ payoutId: string; bankName: string; bankAccountNumber: string; bankAccountName: string; netAmount: number }>;
  }): Promise<{ transRef: string; accepted: boolean }> {
    const transRef = `KBANK-${args.batchNo}`;
    const envelope = signBankPayload(this.secret, { payoutId: args.items[0]?.payoutId ?? args.batchNo, transRef });
    this.logger.log(`KBank batch staged: ${args.batchNo} (${args.items.length} items, envelope ${envelope.slice(0, 12)}…)`);
    return { transRef, accepted: true };
  }
}
