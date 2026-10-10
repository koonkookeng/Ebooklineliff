// SSOT Phase 115 Tasks 3-4 §5.2 — auto-reconciliation engine
// Canonical: apps/backend/src/modules/reconciliation/services/auto-reconciliation-engine.service.ts
// (legacy src/backend/modules/reconciliation/services/auto-reconciliation-engine.service.ts)
// - Flow (BDD-1 <500ms): Zod gate -> SHA-256 dedupe (REJECTED_DUPLICATE) ->
//   account resolve (number→id, enabled) -> anomaly screen (layering/replay
//   → DISCREPANCY/SUSPICIOUS, manual lane) -> UNMATCHED row -> strategy A
//   (slip transRef + cents) -> strategy B (amount+window, unique) -> ONE
//   $transaction: order COMPLETED+VERIFIED + statement AUTO_MATCHED +
//   entitlement upserts + recon log (Gate 7) -> Flex receipt (fail-open) +
//   stream with elapsedMs (Gate 8, §7.1).
// - Entitlement writes go straight through Prisma (same DB; the entitlement
//   module files are read-only context — untouched).
// - Ambiguity (>1) and miss (0) are explicit verdicts with reason codes.
// - Zero new deps.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  BankStatementImportSchema,
  RECON_MATCH_SLA_MS,
  RECON_STREAM,
  hashStatement,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { MatchingStrategyService } from './matching-strategy.service';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { ReconciliationNotificationService } from '../reconciliation-notify.service';
import { buildReconFlex, reconFlexByteSize, RECON_FLEX_BUDGET_BYTES } from '../reconciliation-flex.builder';

export interface IngestResult {
  statementId: string;
  status: string;
  matchedOrderId: string | null;
  score: number;
  algorithm: string;
  executionTimeMs: number;
}

type PrismaAny = {
  user: { findUnique(a: unknown): Promise<unknown> };
  bankStatement: { create(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  bankStatement: { create(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  order: { update(a: unknown): Promise<unknown> };
  entitlement: { upsert(a: unknown): Promise<unknown> };
  reconciliationLog: { create(a: unknown): Promise<unknown> };
};

@Injectable()
export class AutoReconciliationEngineService {
  private readonly logger = new Logger(AutoReconciliationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly repo: ReconciliationRepository,
    private readonly strategies: MatchingStrategyService,
    private readonly notify: ReconciliationNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(RECON_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks reconciliation flows.
    }
  }

  private async lineOf(userId: string): Promise<string | null> {
    const u = (await this.db.user.findUnique({ where: { id: userId } }).catch(() => null)) as { lineUserId?: string | null } | null;
    return u?.lineUserId ?? null;
  }

  /** Ingest one bank line and auto-match it (<500ms budget). */
  async processIncomingStatement(input: unknown, tenantName = 'DEFAULT'): Promise<IngestResult> {
    const startedAt = Date.now();
    const parsed = BankStatementImportSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid bank statement payload');
    const line = parsed.data;

    const hashSign = hashStatement({ transRef: line.transRef, amount: line.amount, txTimestamp: line.txTimestamp });
    const dupe = (await this.repo.statementByHash(hashSign).catch(() => null)) as { id: string } | null;
    if (dupe) {
      await this.repo.appendLog({
        bankStatementId: dupe.id, orderId: null, matchScore: 0, matchedByAlgorithm: 'DUPLICATE_HASH', executionTimeMs: Date.now() - startedAt,
      }).catch(() => undefined);
      await this.publish('recon.duplicate', { statementId: dupe.id, hashSign });
      return { statementId: dupe.id, status: 'REJECTED_DUPLICATE', matchedOrderId: null, score: 0, algorithm: 'DUPLICATE_HASH', executionTimeMs: Date.now() - startedAt };
    }

    const account = (await this.repo.accountByNumber(line.accountNumber).catch(() => null)) as {
      id: string; tenantId: string; autoMatchToleranceMins: number; isEnabled: boolean;
    } | null;
    if (!account || account.isEnabled === false) {
      throw new BadRequestException('Unknown or disabled bank account');
    }

    // §7.1 anomaly screen over the recent sender window.
    const recent = (await this.repo.recentStatementsBySender(line.senderName ?? null).catch(() => [])) as Array<{
      senderName: string | null; amount: unknown; txTimestamp: Date;
    }>;
    const verifiedRefs = await this.repo.verifiedSlipRefs([line.transRef]).catch(() => [] as string[]);
    const anomaly = this.strategies.anomaly({
      transRef: line.transRef,
      amount: line.amount,
      senderName: line.senderName ?? null,
      recent: recent.map((r) => ({ senderName: r.senderName, amount: Number(r.amount ?? 0), at: new Date(r.txTimestamp) })),
      verifiedSlipRefs: verifiedRefs,
    });
    if (anomaly.suspicious) {
      const flagged = await this.db.$transaction(async (txu: unknown) => {
        const tx = txu as unknown as TxAny;
        const row = (await tx.bankStatement.create({
          data: {
            bankAccountId: account.id,
            transRef: line.transRef,
            amount: line.amount,
            txType: line.txType,
            txTimestamp: new Date(line.txTimestamp),
            senderBank: line.senderBank ?? null,
            senderName: line.senderName ?? null,
            rawPayload: (line.rawPayload ?? {}) as Record<string, unknown>,
            hashSign,
            status: 'DISCREPANCY_FLAGGED',
            mismatchReason: 'SUSPICIOUS_PATTERN',
            source: 'BANK_WEBHOOK',
          },
        })) as { id: string };
        await tx.reconciliationLog.create({
          data: { bankStatementId: row.id, orderId: null, matchScore: 0, matchedByAlgorithm: 'FRAUD_SCREEN', executionTimeMs: Date.now() - startedAt },
        });
        return row;
      });
      await this.publish('fraud.suspect', { statementId: flagged.id, reason: anomaly.reason ?? 'SUSPICIOUS_PATTERN', tenantId: account.tenantId });
      return { statementId: flagged.id, status: 'DISCREPANCY_FLAGGED', matchedOrderId: null, score: 0, algorithm: 'FRAUD_SCREEN', executionTimeMs: Date.now() - startedAt };
    }

    // Persist the raw UNMATCHED row first (ingest is never lost).
    const created = (await this.db.bankStatement.create({
      data: {
        bankAccountId: account.id,
        transRef: line.transRef,
        amount: line.amount,
        txType: line.txType,
        txTimestamp: new Date(line.txTimestamp),
        senderBank: line.senderBank ?? null,
        senderName: line.senderName ?? null,
        rawPayload: (line.rawPayload ?? {}) as Record<string, unknown>,
        hashSign,
        status: 'UNMATCHED',
        source: 'BANK_WEBHOOK',
      },
    }).catch(() => null)) as { id: string } | null;
    if (!created) throw new BadRequestException('Statement ingest failed (possible duplicate transRef)');

    // Strategy A: exact slip transRef.
    const slip = (await this.repo.slipByTransRef(line.transRef).catch(() => null)) as {
      transRef: string | null; amount: unknown; orderId: string;
    } | null;
    const exact = this.strategies.byTransRef(
      { transRef: line.transRef, amount: line.amount },
      slip ? { transRef: slip.transRef, amount: Number(slip.amount ?? 0), orderId: slip.orderId } : null,
    );
    if (exact && exact.kind === 'EXACT') {
      return this.applyAtomicMatch({ statementId: created.id, orderId: exact.orderId, score: exact.score, algorithm: exact.algorithm, startedAt, tenantName });
    }

    // Strategy B: unique amount+window candidate.
    const pool = (await this.repo.pendingOrdersByAmountNet(line.amount).catch(() => [])) as Array<{
      id: string; netAmount: unknown; createdAt: Date;
    }>;
    const windowed = this.strategies.byAmountWindow(
      { amount: line.amount, txTimestamp: new Date(line.txTimestamp) },
      pool.map((o) => ({ id: o.id, netAmount: Number(o.netAmount ?? 0), createdAt: new Date(o.createdAt) })),
      account.autoMatchToleranceMins ?? 30,
    );
    if (windowed.kind === 'WINDOW_UNIQUE') {
      return this.applyAtomicMatch({ statementId: created.id, orderId: windowed.orderId, score: windowed.score, algorithm: windowed.algorithm, startedAt, tenantName });
    }
    if (windowed.kind === 'AMBIGUOUS') {
      await this.db.bankStatement.update({
        where: { id: created.id },
        data: { status: 'DISCREPANCY_FLAGGED', mismatchReason: 'MULTIPLE_CANDIDATE_ORDERS' },
      }).catch(() => undefined);
      await this.repo.appendLog({
        bankStatementId: created.id, orderId: null, matchScore: windowed.score, matchedByAlgorithm: windowed.algorithm, executionTimeMs: Date.now() - startedAt,
      }).catch(() => undefined);
      await this.publish('recon.discrepancy', { statementId: created.id, reason: 'MULTIPLE_CANDIDATE_ORDERS', tenantId: account.tenantId });
      return { statementId: created.id, status: 'DISCREPANCY_FLAGGED', matchedOrderId: null, score: windowed.score, algorithm: windowed.algorithm, executionTimeMs: Date.now() - startedAt };
    }
    await this.db.bankStatement.update({
      where: { id: created.id },
      data: { status: 'UNMATCHED', mismatchReason: 'REF_NOT_FOUND' },
    }).catch(() => undefined);
    await this.repo.appendLog({
      bankStatementId: created.id, orderId: null, matchScore: 0, matchedByAlgorithm: 'NONE', executionTimeMs: Date.now() - startedAt,
    }).catch(() => undefined);
    return { statementId: created.id, status: 'UNMATCHED', matchedOrderId: null, score: 0, algorithm: 'NONE', executionTimeMs: Date.now() - startedAt };
  }

  /** Atomic match: order COMPLETED+VERIFIED, statement linked, entitlements upserted. */
  private async applyAtomicMatch(args: { statementId: string; orderId: string; score: number; algorithm: string; startedAt: number; tenantName: string }): Promise<IngestResult> {
    const out = await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny & {
        order: { update(a: unknown): Promise<unknown> };
      };
      const updatedOrder = (await tx.order.update({
        where: { id: args.orderId },
        data: { orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED' },
        include: { orderItems: true },
      })) as { id: string; userId: string; orderItems: Array<{ productId: string }> };
      await tx.bankStatement.update({ where: { id: args.statementId }, data: { status: 'AUTO_MATCHED', matchedOrderId: args.orderId } });
      for (const item of updatedOrder.orderItems) {
        await tx.entitlement.upsert({
          where: { userId_productId: { userId: updatedOrder.userId, productId: item.productId } },
          update: { accessType: 'FULL_PURCHASE' },
          create: { userId: updatedOrder.userId, productId: item.productId, accessType: 'FULL_PURCHASE' },
        });
      }
      await tx.reconciliationLog.create({
        data: { bankStatementId: args.statementId, orderId: args.orderId, matchScore: args.score, matchedByAlgorithm: args.algorithm, executionTimeMs: Date.now() - args.startedAt },
      });
      return updatedOrder;
    });
    const executionTimeMs = Date.now() - args.startedAt;
    if (executionTimeMs > RECON_MATCH_SLA_MS) {
      this.logger.warn(`Match SLA breach for ${args.statementId}: ${executionTimeMs}ms`);
    }
    const bubble = buildReconFlex({ outcome: 'RECEIPT', amountThb: 0, tenantName: args.tenantName, ref: args.orderId, detail: `จับคู่อัตโนมัติ (${args.algorithm})` });
    if (reconFlexByteSize(bubble) <= RECON_FLEX_BUDGET_BYTES) {
      try {
        await this.notify.notify(await this.lineOf(out.userId), 'RECEIPT', JSON.stringify(bubble));
      } catch {
        // Notify is fail-open — the match transaction already committed.
      }
    }
    await this.publish('recon.matched', { statementId: args.statementId, orderId: args.orderId, score: args.score, algorithm: args.algorithm, executionTimeMs });
    return { statementId: args.statementId, status: 'AUTO_MATCHED', matchedOrderId: args.orderId, score: args.score, algorithm: args.algorithm, executionTimeMs };
  }
}
