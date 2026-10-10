// SSOT Phase 115 Task 5 §4.1/BDD-2 — maker-checker manual override service
// Canonical: apps/backend/src/modules/reconciliation/services/manual-override.service.ts
// (legacy src/backend/modules/reconciliation/services/manual-override.service.ts)
// - Initiate (maker, FINANCE_ADMIN): Zod gate -> statement must be
//   UNMATCHED/DISCREPANCY_FLAGGED (never re-link AUTO_MATCHED or
//   MANUAL_OVERRIDDEN) -> order must exist and NOT be COMPLETED ->
//   amount >1000 → PENDING + provisional chain hash (checker lane);
//   ≤1000 → immediate apply (maker == approver, single control).
// - Approve (checker ≠ maker): atomic apply — statement MANUAL_OVERRIDDEN +
//   order COMPLETED/VERIFIED + slip VERIFIED + entitlement upserts +
//   override approved + recon log (Gate 7) -> chain head advance (post-commit)
//   -> Flex + stream. A designated checkerUserId (optional payload) routes
//   via the pending stream event and is enforced at approval time.
// - auditHash = H(prev | stmt | order | maker | ts) with the row createdAt
//   pinned to ts so verifyChain replays exactly (§8.1).
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ManualOverridePayloadSchema, RECON_STREAM, chainStep, makerCheckerRequired } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { AuditChainService } from './audit-chain.service';
import { ReconciliationNotificationService } from '../reconciliation-notify.service';
import { buildReconFlex, reconFlexByteSize, RECON_FLEX_BUDGET_BYTES } from '../reconciliation-flex.builder';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

export interface OverrideInitiated {
  overrideId: string;
  statementId: string;
  orderId: string;
  needsChecker: boolean;
  auditHash: string;
}

type PrismaAny = {
  order: { findUnique(a: unknown): Promise<unknown> };
  bankStatement: { findUnique(a: unknown): Promise<unknown> };
  financialManualOverride: { findUnique(a: unknown): Promise<unknown>; findMany(a: unknown): Promise<unknown[]> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  bankStatement: { update(a: unknown): Promise<unknown> };
  order: { update(a: unknown): Promise<unknown> };
  paymentSlip: { updateMany(a: unknown): Promise<unknown> };
  entitlement: { upsert(a: unknown): Promise<unknown> };
  financialManualOverride: { create(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  reconciliationLog: { create(a: unknown): Promise<unknown> };
};

export type OverrideRow = {
  id: string;
  bankStatementId: string;
  orderId: string;
  initiatedBy: string;
  reason: string;
  note: string | null;
  auditHash: string;
  isApproved: boolean;
  previousStatus: string;
};

@Injectable()
export class ManualOverrideService {
  private readonly logger = new Logger(ManualOverrideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly chain: AuditChainService,
    private readonly notify: ReconciliationNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(RECON_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks override flows.
    }
  }

  private async lineOf(userId: string): Promise<string | null> {
    const u = (await (this.prisma as unknown as {
      user: { findUnique(a: unknown): Promise<unknown> };
    }).user.findUnique({ where: { id: userId } }).catch(() => null)) as { lineUserId?: string | null } | null;
    return u?.lineUserId ?? null;
  }

  /** Maker initiates a manual link (dual control above 1,000 THB). */
  async initiateOverride(
    maker: { id: string; role: string | undefined },
    input: unknown,
    net: { ipAddress: string; userAgent: string },
    tenantId = 'DEFAULT',
  ): Promise<OverrideInitiated> {
    this.assertFinance(maker.role);
    const parsed = ManualOverridePayloadSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid override payload');
    const { statementId, orderId, overrideReason, adjustmentNote, checkerUserId } = parsed.data;

    const statement = (await this.db.bankStatement.findUnique({ where: { id: statementId } }).catch(() => null)) as {
      id: string; amount: unknown; status: string;
    } | null;
    if (!statement) throw new BadRequestException('Bank statement not found');
    if (statement.status === 'AUTO_MATCHED' || statement.status === 'MANUAL_OVERRIDDEN') {
      throw new BadRequestException(`Statement already ${statement.status} — override forbidden`);
    }
    const order = (await this.db.order.findUnique({ where: { id: orderId } }).catch(() => null)) as {
      id: string; userId: string; orderStatus: string;
    } | null;
    if (!order) throw new BadRequestException('Target order not found');
    if (order.orderStatus === 'COMPLETED') {
      throw new BadRequestException('Target order already COMPLETED — override forbidden');
    }

    const amount = Number(statement.amount ?? 0);
    const ts = new Date().toISOString();
    const prevHead = await this.chain.head(tenantId);
    const auditHash = chainStep(prevHead, { statementId, orderId, initiatedBy: maker.id, timestamp: ts });

    if (!makerCheckerRequired(amount)) {
      // Single control ≤1000 THB: apply immediately, maker == approver.
      const startedAt = Date.now();
      await this.db.$transaction(async (txu: unknown) => {
        await this.applyInTx(txu as unknown as TxAny, {
          statementId, orderId, checkerId: maker.id,
          reason: overrideReason, note: adjustmentNote ?? null, auditHash, ts,
          previousStatus: statement.status,
          ipAddress: net.ipAddress, userAgent: net.userAgent,
          createOverride: { initiatedBy: maker.id, approved: true },
        });
      });
      await this.chain.mint(tenantId, { statementId, orderId, initiatedBy: maker.id, timestamp: ts }).catch(() => undefined);
      await this.afterApply(order.userId, statementId, orderId, auditHash, tenantId, Date.now() - startedAt);
      return { overrideId: '', statementId, orderId, needsChecker: false, auditHash };
    }

    const row = (await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      return tx.financialManualOverride.create({
        data: {
          bankStatementId: statementId,
          orderId,
          initiatedBy: maker.id,
          reason: overrideReason,
          note: adjustmentNote ?? null,
          previousStatus: statement.status,
          newStatus: 'MANUAL_OVERRIDDEN',
          isApproved: false,
          auditHash,
          ipAddress: net.ipAddress,
          userAgent: net.userAgent,
          createdAt: new Date(ts),
        },
      });
    })) as { id: string };
    await this.publish('recon.override.pending', {
      overrideId: row.id, statementId, orderId, makerId: maker.id, tenantId,
      ...(checkerUserId ? { checkerUserId } : {}),
    });
    const bubble = buildReconFlex({ outcome: 'OVERRIDE_PENDING', amountThb: amount, tenantName: tenantId, ref: statementId });
    if (reconFlexByteSize(bubble) <= RECON_FLEX_BUDGET_BYTES) {
      try {
        await this.notify.notify(await this.lineOf(order.userId), 'OVERRIDE_PENDING', JSON.stringify(bubble));
      } catch {
        // Notify is fail-open.
      }
    }
    return { overrideId: row.id, statementId, orderId, needsChecker: true, auditHash };
  }

  /** Checker (≠ maker, designated pin enforced) approves a pending override. */
  async approveOverrideChecker(
    checker: { id: string; role: string | undefined },
    overrideId: string,
    net: { ipAddress: string; userAgent: string },
    tenantId = 'DEFAULT',
    designatedCheckerId?: string,
  ): Promise<boolean> {
    this.assertFinance(checker.role);
    if (!overrideId) throw new BadRequestException('Missing overrideId');
    const row = (await this.db.financialManualOverride.findUnique({ where: { id: overrideId } }).catch(() => null)) as OverrideRow | null;
    if (!row) throw new BadRequestException('Override record not found');
    if (row.isApproved) throw new BadRequestException('Override already approved');
    if (row.initiatedBy === checker.id) {
      throw new ForbiddenException('Maker cannot check their own override (dual control)');
    }
    if (designatedCheckerId && designatedCheckerId !== checker.id) {
      throw new ForbiddenException('Override is pinned to a designated checker');
    }
    const order = (await this.db.order.findUnique({ where: { id: row.orderId } }).catch(() => null)) as {
      id: string; userId: string;
    } | null;
    if (!order) throw new BadRequestException('Target order not found');

    const startedAt = Date.now();
    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.financialManualOverride.update({ where: { id: overrideId }, data: { isApproved: true, approvedBy: checker.id } });
      await this.applyInTx(tx, {
        statementId: row.bankStatementId,
        orderId: row.orderId,
        checkerId: checker.id,
        reason: row.reason,
        note: row.note,
        auditHash: row.auditHash,
        ts: new Date().toISOString(),
        previousStatus: row.previousStatus,
        ipAddress: net.ipAddress,
        userAgent: net.userAgent,
      });
    });
    await this.chain.mint(tenantId, { statementId: row.bankStatementId, orderId: row.orderId, initiatedBy: row.initiatedBy, timestamp: new Date().toISOString() }).catch(() => undefined);
    this.logger.log(`Override ${overrideId} approved by ${checker.id}`);
    await this.afterApply(order.userId, row.bankStatementId, row.orderId, row.auditHash, tenantId, Date.now() - startedAt);
    return true;
  }

  /** Verify the tenant hash chain (fail-closed break report). */
  async verifyChain(): Promise<{ valid: boolean; checked: number; brokenAt?: number }> {
    const rows = (await this.db.financialManualOverride.findMany({ orderBy: { createdAt: 'asc' }, take: 500 }).catch(() => [])) as Array<{
      bankStatementId: string; orderId: string; initiatedBy: string; createdAt: Date; auditHash: string;
    }>;
    return this.chain.verify(rows.map((r) => ({
      statementId: r.bankStatementId,
      orderId: r.orderId,
      initiatedBy: r.initiatedBy,
      createdAt: new Date(r.createdAt),
      auditHash: r.auditHash,
    })));
  }

  /** Shared atomic apply (statement + order + slip + entitlements + log). */
  private async applyInTx(
    tx: TxAny,
    args: { statementId: string; orderId: string; checkerId: string; reason: string; note: string | null; auditHash: string; ts: string; previousStatus: string; ipAddress: string; userAgent: string; createOverride?: { initiatedBy: string; approved: boolean } },
  ): Promise<void> {
    const updatedOrder = (await (tx as unknown as {
      order: { update(a: unknown): Promise<unknown> };
    }).order.update({
      where: { id: args.orderId },
      data: { orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED' },
      include: { orderItems: true },
    })) as { id: string; userId: string; orderItems: Array<{ productId: string }> };
    await tx.bankStatement.update({ where: { id: args.statementId }, data: { status: 'MANUAL_OVERRIDDEN', matchedOrderId: args.orderId } });
    await tx.paymentSlip.updateMany({ where: { orderId: args.orderId }, data: { verifiedAt: new Date(args.ts) } });
    for (const item of updatedOrder.orderItems) {
      await tx.entitlement.upsert({
        where: { userId_productId: { userId: updatedOrder.userId, productId: item.productId } },
        update: { accessType: 'FULL_PURCHASE' },
        create: { userId: updatedOrder.userId, productId: item.productId, accessType: 'FULL_PURCHASE' },
      });
    }
    await tx.reconciliationLog.create({
      data: { bankStatementId: args.statementId, orderId: args.orderId, matchScore: 100, matchedByAlgorithm: 'MANUAL_OVERRIDE', executionTimeMs: 0 },
    });
    if (args.createOverride) {
      await tx.financialManualOverride.create({
        data: {
          bankStatementId: args.statementId,
          orderId: args.orderId,
          initiatedBy: args.createOverride.initiatedBy,
          approvedBy: args.createOverride.approved ? args.checkerId : null,
          reason: args.reason,
          note: args.note,
          previousStatus: args.previousStatus,
          newStatus: 'MANUAL_OVERRIDDEN',
          isApproved: args.createOverride.approved,
          auditHash: args.auditHash,
          ipAddress: args.ipAddress,
          userAgent: args.userAgent,
          createdAt: new Date(args.ts),
        },
      });
    }
  }

  private async afterApply(buyerId: string, statementId: string, orderId: string, auditHash: string, tenantId: string, elapsedMs: number): Promise<void> {
    const bubble = buildReconFlex({ outcome: 'OVERRIDE_OK', amountThb: 0, tenantName: tenantId, ref: orderId, detail: `audit ${auditHash.slice(0, 12)}…` });
    if (reconFlexByteSize(bubble) <= RECON_FLEX_BUDGET_BYTES) {
      try {
        await this.notify.notify(buyerId ? await this.lineOf(buyerId) : null, 'OVERRIDE_OK', JSON.stringify(bubble));
      } catch {
        // Notify is fail-open.
      }
    }
    await this.publish('recon.overridden', { statementId, orderId, auditHash: auditHash.slice(0, 16), tenantId, elapsedMs });
  }

  private assertFinance(role: string | undefined): void {
    if (!role || !ADMIN_ROLES.has(role)) throw new ForbiddenException('Manual override requires a finance admin role');
  }
}
