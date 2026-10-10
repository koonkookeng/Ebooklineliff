// SSOT Phase 114 Task 7 §7.1 — bank-statement reconciliation engine
// Canonical: apps/backend/src/modules/clearinghouse/reconciliation-engine.service.ts
// (legacy src/backend/modules/clearinghouse/reconciliation-engine.service.ts)
// - Compares bank inflow lines vs recorded order amounts; drift above 0.01
//   THB trips DISCREPANCY_HOLD: Redis flag per order (24h TTL) + seller
//   payout freeze flag + incident stream for the finance dashboard.
//   Statement ingestion/matching detail stays in the 115 lane (Zero
//   Redundant) — this engine owns verdicts + freezes only.
// - Payout gate reads isSellerFrozen (fail-open on Redis outage + warn,
//   113 precedent). Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { CLEARINGHOUSE_STREAM, RECONCILE_DRIFT_TRIP_THB, discrepancyKey } from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';

export interface StatementLine {
  orderId: string;
  amount: number;
  transRef?: string;
}

export interface ReconcileVerdict {
  orderId: string;
  recorded: number;
  stated: number;
  drift: number;
  matched: boolean;
}

export interface ReconcileResult {
  matched: number;
  discrepancies: ReconcileVerdict[];
  msPerItem: number;
}

/** Redis TTL for discrepancy + seller-freeze flags (24h). */
export const DISCREPANCY_FLAG_TTL_SEC = 24 * 60 * 60;

function sellerFreezeKey(sellerId: string): string {
  return `clearing:seller-freeze:${sellerId}`;
}

type PrismaAny = {
  order: { findUnique(a: unknown): Promise<unknown> };
  escrowAccount: { findFirst(a: unknown): Promise<unknown> };
};

@Injectable()
export class ReconciliationEngineService {
  private readonly logger = new Logger(ReconciliationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  /** Match a batch of bank lines; flag drifts (50ms/item budget). */
  async reconcileBatch(tenantId: string, lines: StatementLine[]): Promise<ReconcileResult> {
    const startedAt = Date.now();
    let matched = 0;
    const discrepancies: ReconcileVerdict[] = [];
    for (const line of lines) {
      const order = (await this.db.order.findUnique({ where: { id: line.orderId } }).catch(() => null)) as {
        netAmount: unknown;
      } | null;
      if (!order) continue;
      const recorded = Number(order.netAmount ?? 0);
      const drift = Math.round((line.amount - recorded) * 100) / 100;
      if (Math.abs(drift) <= RECONCILE_DRIFT_TRIP_THB) {
        matched++;
        continue;
      }
      const verdict: ReconcileVerdict = { orderId: line.orderId, recorded, stated: line.amount, drift, matched: false };
      discrepancies.push(verdict);
      try {
        await this.redis.setex(discrepancyKey(line.orderId), DISCREPANCY_FLAG_TTL_SEC, JSON.stringify({ ...verdict, tenantId }));
        const escrow = (await this.db.escrowAccount.findFirst({ where: { orderId: line.orderId } }).catch(() => null)) as { sellerId: string } | null;
        if (escrow?.sellerId) {
          await this.redis.setex(sellerFreezeKey(escrow.sellerId), DISCREPANCY_FLAG_TTL_SEC, line.orderId);
        }
        await this.redis.xaddPipeline(CLEARINGHOUSE_STREAM, [{
          event: 'clearinghouse.discrepancy', tenantId, orderId: line.orderId, drift, at: Date.now(),
        }]);
      } catch {
        // Flag persistence is best-effort; the verdict list is returned regardless.
      }
    }
    const msPerItem = lines.length === 0 ? 0 : (Date.now() - startedAt) / lines.length;
    return { matched, discrepancies, msPerItem };
  }

  /** Order-level discrepancy probe (settlement/payout pre-checks). */
  async hasDiscrepancy(orderId: string): Promise<boolean> {
    try {
      return (await this.redis.get(discrepancyKey(orderId))) !== null;
    } catch {
      return false;
    }
  }

  /** Seller payout freeze probe (fail-open + warn on Redis outage). */
  async isSellerFrozen(sellerId: string): Promise<boolean> {
    try {
      return (await this.redis.get(sellerFreezeKey(sellerId))) !== null;
    } catch (err) {
      this.logger.warn(`Freeze probe fail-open for ${sellerId}: ${(err as Error).message}`);
      return false;
    }
  }
}
