// SSOT Phase 114 Task 3 §5.1/BDD-2 — automated seller payout processor
// Canonical: apps/backend/src/modules/clearinghouse/payout-processor.service.ts
// (legacy src/backend/modules/clearinghouse/payout-processor.service.ts)
// - Flow: Zod gate (100 THB floor) -> self-or-admin -> e-KYC VERIFIED +
//   ACTIVE payout account (085 tables, read-only; bank number decrypted via
//   KycEncryptionService reuse) -> settled-balance check (RELEASED escrow −
//   open/paid payouts) -> discrepancy freeze gate -> 3% quote (082 facade) ->
//   ONE $transaction: SellerPayout PROCESSING + transRef + wallet decrement +
//   balanced payout legs + cert path (Gate 7) -> bank + cert streams for the
//   086/082 lanes (staged transport, never recompiled here) + Flex.
// - Does NOT duplicate 086 request/clearing or 081 journals: distinct tables,
//   distinct lane (settled-balance automation vs manual request clearing).
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CLEARINGHOUSE_STREAM,
  SellerPayoutRequestSchema,
  assertSettlementBalanced,
  availablePayout,
} from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { KycEncryptionService } from '../kyc/services/kyc-encryption.service';
import { ClearinghouseTaxService } from './tax-calculator.service';
import { ReconciliationEngineService } from './reconciliation-engine.service';
import { ClearinghouseNotificationService } from './clearinghouse-notify.service';
import { buildPayoutFlex, payoutFlexByteSize, PAYOUT_FLEX_BUDGET_BYTES } from './payout-flex.builder';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

/** Per-seller payout mutex TTL (bounds the blast radius on crash). */
const PAYOUT_LOCK_TTL_SEC = 30;

function payoutLockKey(sellerId: string): string {
  return `clearing:payout-lock:${sellerId}`;
}

export interface PayoutExecutionResult {
  payoutId: string;
  sellerId: string;
  grossAmount: number;
  taxAmount: number;
  netPayoutAmount: number;
  status: string;
  taxCertificateUrl: string | null;
  executedAt: string;
}

type PrismaAny = {
  user: { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  creatorPayoutAccount: { findFirst(a: unknown): Promise<unknown> };
  escrowAccount: { findMany(a: unknown): Promise<unknown[]> };
  sellerPayout: { findMany(a: unknown): Promise<unknown[]> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  sellerPayout: { create(a: unknown): Promise<unknown> };
  user: { update(a: unknown): Promise<unknown> };
  financialClearinghouseLedger: { create(a: unknown): Promise<unknown> };
};

@Injectable()
export class PayoutProcessorService {
  private readonly logger = new Logger(PayoutProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly encryption: KycEncryptionService,
    private readonly tax: ClearinghouseTaxService,
    private readonly recon: ReconciliationEngineService,
    private readonly notify: ClearinghouseNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(CLEARINGHOUSE_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks payout flows.
    }
  }

  /** Settled (RELEASED) escrow net available to a seller. */
  async settledBalance(sellerId: string): Promise<{ releasedNet: number; openPayouts: number; completedPayouts: number; available: number }> {
    const [escrows, payouts] = await Promise.all([
      this.db.escrowAccount.findMany({ where: { sellerId, status: 'RELEASED_TO_SELLER' } }).catch(() => []),
      this.db.sellerPayout.findMany({ where: { sellerId } }).catch(() => []),
    ]);
    const releasedNet = (escrows as Array<{ netSellerPay: unknown }>).reduce((s, r) => s + Number(r.netSellerPay ?? 0), 0);
    let openPayouts = 0;
    let completedPayouts = 0;
    for (const p of payouts as Array<{ payoutStatus: string; netPayoutAmount: unknown }>) {
      if (p.payoutStatus === 'COMPLETED') completedPayouts += Number(p.netPayoutAmount ?? 0);
      else if (p.payoutStatus === 'PENDING' || p.payoutStatus === 'PROCESSING') openPayouts += Number(p.netPayoutAmount ?? 0);
    }
    const available = availablePayout({ releasedNet, openPayouts, completedPayouts });
    return { releasedNet, openPayouts, completedPayouts, available };
  }

  /** Automated payout from settled balance (BDD-2, atomic, <1s target). */
  async requestSellerPayout(actor: { id: string; role: string | undefined }, input: unknown, tenantId = 'default'): Promise<PayoutExecutionResult> {
    const parsed = SellerPayoutRequestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid payout request');
    const { sellerId, requestedAmount } = parsed.data;
    const isAdmin = !!actor.role && ADMIN_ROLES.has(actor.role);
    if (!isAdmin && sellerId !== actor.id) throw new ForbiddenException('Can only request your own payout');

    const user = (await this.db.user.findUnique({ where: { id: sellerId } }).catch(() => null)) as {
      id: string; kycStatus: string; lineUserId?: string | null; walletBalance: unknown;
    } | null;
    if (!user || user.kycStatus !== 'VERIFIED') {
      throw new BadRequestException('Seller has not completed e-KYC tax verification');
    }
    const account = (await this.db.creatorPayoutAccount.findFirst({ where: { userId: sellerId, status: 'ACTIVE' } }).catch(() => null)) as {
      bankCode: string; bankAccountNumberEnc: string; bankAccountName: string;
    } | null;
    if (!account) throw new BadRequestException('No verified bank account for seller');
    let bankAccountNumber = '';
    try {
      bankAccountNumber = this.encryption.decrypt(account.bankAccountNumberEnc);
    } catch {
      throw new BadRequestException('Bank account unreadable — re-verify payout account');
    }

    if (await this.recon.isSellerFrozen(sellerId)) {
      throw new BadRequestException('Payouts frozen: unresolved cashflow discrepancy (DISPUTE_HOLD)');
    }

    // Per-seller mutex against concurrent double-spend (TOCTOU between the
    // balance pre-read and the commit). Contention → retryable 400; Redis
    // outage → fail-open with warn (availability wins, blast radius = one
    // seller window; the wallet decrement + unique transRef stay atomic).
    const lockKey = payoutLockKey(sellerId);
    let locked = false;
    let redisUp = true;
    try {
      locked = await this.redis.setnx(lockKey, '1', PAYOUT_LOCK_TTL_SEC);
    } catch (err) {
      redisUp = false;
      this.logger.warn(`Payout lock fail-open for ${sellerId}: ${(err as Error).message}`);
    }
    if (redisUp && !locked) {
      throw new BadRequestException('Another payout is in progress — retry shortly');
    }
    try {
      return await this.executeLocked(
        sellerId,
        { bankCode: account.bankCode, bankAccountNumber, bankAccountName: account.bankAccountName },
        requestedAmount,
        tenantId,
        user.lineUserId ?? null,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.del(lockKey);
        } catch {
          // Best-effort release (TTL bounds the blast radius).
        }
      }
    }
  }

  private async executeLocked(
    sellerId: string,
    bank: { bankCode: string; bankAccountNumber: string; bankAccountName: string },
    requestedAmount: number,
    tenantId: string,
    lineUserId: string | null,
  ): Promise<PayoutExecutionResult> {
    const balance = await this.settledBalance(sellerId);
    if (requestedAmount > balance.available) {
      throw new BadRequestException(`Requested ${requestedAmount} exceeds settled balance ${balance.available}`);
    }

    const quote = this.tax.quote(requestedAmount);
    const transRef = `PAY-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const taxCertificatePath = `tax-certs/${tenantId}/${transRef}.pdf`;
    const startedAt = Date.now();

    const payoutId = await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      const row = (await tx.sellerPayout.create({
        data: {
          tenantId,
          sellerId,
          grossAmount: quote.grossAmount,
          taxRatePercent: quote.taxRatePercent,
          taxWithheldAmount: quote.taxAmount,
          netPayoutAmount: quote.netAmount,
          payoutStatus: 'PROCESSING',
          bankName: bank.bankCode,
          bankAccountNumber: bank.bankAccountNumber,
          bankAccountName: bank.bankAccountName,
          transRef,
          taxCertificatePath,
          executedAt: new Date(),
        },
      })) as { id: string };
      await tx.user.update({ where: { id: sellerId }, data: { walletBalance: { decrement: quote.grossAmount } } });
      const legs = [
        { accountType: 'CREATOR_PAYABLE', entryType: 'DEBIT' as const, amount: quote.grossAmount },
        { accountType: 'TAX_WITHHOLDING_PAYABLE', entryType: 'CREDIT' as const, amount: quote.taxAmount },
        { accountType: 'CASH_ASSET', entryType: 'CREDIT' as const, amount: quote.netAmount },
      ];
      assertSettlementBalanced(legs);
      for (const leg of legs) {
        await tx.financialClearinghouseLedger.create({
          data: {
            tenantId,
            payoutId: row.id,
            accountType: leg.accountType,
            entryType: leg.entryType,
            amount: leg.amount,
            currency: 'THB',
            description: `Seller payout ${transRef} (${leg.accountType})`,
            referenceCode: `${transRef}-${leg.accountType}`,
          },
        });
      }
      return row.id;
    });

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 1000) this.logger.warn(`Payout SLA breach for ${payoutId}: ${elapsedMs}ms`);
    await this.publish('payout.executing', { payoutId, sellerId, tenantId, grossAmount: quote.grossAmount, netAmount: quote.netAmount, transRef, elapsedMs });
    await this.publish('payout.bank.requested', { payoutId, sellerId, tenantId, netAmount: quote.netAmount, bankName: bank.bankCode, transRef });
    await this.publish('payout.taxCert.requested', { payoutId, sellerId, tenantId, grossAmount: quote.grossAmount, certPath: taxCertificatePath });
    const bubble = buildPayoutFlex({ payoutId, gross: quote.grossAmount, tax: quote.taxAmount, net: quote.netAmount, tenantName: tenantId });
    if (payoutFlexByteSize(bubble) <= PAYOUT_FLEX_BUDGET_BYTES) {
      try {
        await this.notify.notify(lineUserId, 'PAYOUT_EXECUTING', JSON.stringify(bubble));
      } catch {
        // Notify is fail-open — the payout transaction already committed.
      }
    }
    return {
      payoutId,
      sellerId,
      grossAmount: quote.grossAmount,
      taxAmount: quote.taxAmount,
      netPayoutAmount: quote.netAmount,
      status: 'PROCESSING',
      taxCertificateUrl: null,
      executedAt: new Date().toISOString(),
    };
  }
}
