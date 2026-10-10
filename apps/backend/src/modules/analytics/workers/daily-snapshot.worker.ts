// SSOT Phase 116 Task 4 §7 — nightly snapshot worker (pre-computed BI cache)
// Canonical: apps/backend/src/modules/analytics/workers/daily-snapshot.worker.ts
// - buildSnapshot(tenant, day): day GMV/orders (COMPLETED), new/active/
//   churned users, AOV/LTV/CAC/churn% → upsert on (tenantId, snapshotDate)
//   (Gate 7: single-row upsert, never blocks core writes) -> stream.
// - runOnce(tenants, day): per-tenant fail-open loop (one bad tenant never
//   wedges the night). The module does NOT auto-start (bootstrap-owned).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import {
  CHURN_INACTIVITY_DAYS,
  averageOrderValue,
  churnRatePercentage,
  customerAcquisitionCost,
  customerLifetimeValue,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

export interface SnapshotBuilt {
  tenantId: string;
  snapshotDate: string;
  gmv: number;
  totalOrders: number;
  churnRatePercentage: number;
}

type PrismaAny = {
  order: { findMany(a: unknown): Promise<unknown[]> };
  user: { findMany(a: unknown): Promise<unknown[]>; count(a: unknown): Promise<number> };
  marketingCampaign: { findMany(a: unknown): Promise<unknown[]> };
  ebookReadingProgress: { findMany(a: unknown): Promise<unknown[]> };
  courseLearningProgress: { findMany(a: unknown): Promise<unknown[]> };
  dailyAnalyticsSnapshot: { upsert(a: unknown): Promise<unknown> };
};

const READ_TAKE = 10000;

@Injectable()
export class DailySnapshotWorker {
  private readonly logger = new Logger(DailySnapshotWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  async buildSnapshot(tenantId: string, day: Date): Promise<SnapshotBuilt> {
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 86400000);
    const cutoff = new Date(end.getTime() - CHURN_INACTIVITY_DAYS * 86400000);

    const [orders, newUsers, totalCustomers, adRows, reads, watches] = await Promise.all([
      this.db.order.findMany({
        where: { tenantId, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', createdAt: { gte: start, lt: end } },
        select: { netAmount: true },
        take: READ_TAKE,
      }).catch(() => []),
      this.db.user.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { id: true }, take: READ_TAKE }).catch(() => []),
      this.db.user.count({}).catch(() => 0),
      this.db.marketingCampaign.findMany({ where: { tenantId }, select: { totalAdSpend: true } }).catch(() => []),
      this.db.ebookReadingProgress.findMany({ where: { updatedAt: { gte: start, lt: end } }, select: { userId: true }, take: READ_TAKE }).catch(() => []),
      this.db.courseLearningProgress.findMany({ where: { updatedAt: { gte: start, lt: end } }, select: { userId: true }, take: READ_TAKE }).catch(() => []),
    ]);

    const gmv = (orders as Array<{ netAmount: unknown }>).reduce((s, r) => s + Number(r.netAmount ?? 0), 0);
    const totalOrders = (orders as unknown[]).length;
    const activeIds = new Set<string>();
    for (const r of [...(reads as Array<{ userId: string }>), ...(watches as Array<{ userId: string }>)]) activeIds.add(r.userId);
    const oldMembers = (await this.db.user.findMany({
      where: { role: 'MEMBER', createdAt: { lt: cutoff } }, select: { id: true }, take: READ_TAKE,
    }).catch(() => [])) as Array<{ id: string }>;
    let churned = 0;
    for (const m of oldMembers) {
      if (!activeIds.has(m.id)) churned++;
    }
    const adSpend = (adRows as Array<{ totalAdSpend: unknown }>).reduce((s, r) => s + Number(r.totalAdSpend ?? 0), 0);
    const netRevenue = Math.round(gmv * 0.95 * 100) / 100;

    await (this.prisma as unknown as {
      dailyAnalyticsSnapshot: { upsert(a: unknown): Promise<unknown> };
    }).dailyAnalyticsSnapshot.upsert({
      where: { tenantId_snapshotDate: { tenantId, snapshotDate: start } },
      update: {
        gmv, netRevenue, totalOrders,
        newUsersCount: (newUsers as unknown[]).length,
        activeUsersCount: activeIds.size,
        churnedUsersCount: churned,
        avgOrderValue: averageOrderValue(gmv, totalOrders),
        calculatedLtv: customerLifetimeValue(gmv, totalCustomers),
        calculatedCac: customerAcquisitionCost(adSpend, totalCustomers),
        churnRatePercentage: churnRatePercentage(churned, oldMembers.length),
      },
      create: {
        tenantId,
        snapshotDate: start,
        gmv,
        netRevenue,
        totalOrders,
        newUsersCount: (newUsers as unknown[]).length,
        activeUsersCount: activeIds.size,
        churnedUsersCount: churned,
        avgOrderValue: averageOrderValue(gmv, totalOrders),
        calculatedLtv: customerLifetimeValue(gmv, totalCustomers),
        calculatedCac: customerAcquisitionCost(adSpend, totalCustomers),
        churnRatePercentage: churnRatePercentage(churned, oldMembers.length),
      },
    });

    try {
      await this.redis.xaddPipeline('stream:analytics:snapshot', [{
        event: 'analytics.snapshot.built', tenantId, snapshotDate: start.toISOString(), gmv, totalOrders, at: Date.now(),
      }]);
    } catch {
      // Telemetry never breaks the nightly worker.
    }
    return {
      tenantId,
      snapshotDate: start.toISOString(),
      gmv: Math.round(gmv * 100) / 100,
      totalOrders,
      churnRatePercentage: churnRatePercentage(churned, oldMembers.length),
    };
  }

  async runOnce(tenantIds: string[], day: Date): Promise<{ built: number; failed: number }> {
    let built = 0;
    let failed = 0;
    for (const tenantId of tenantIds) {
      try {
        await this.buildSnapshot(tenantId, day);
        built++;
      } catch (err) {
        failed++;
        this.logger.warn(`Snapshot failed for ${tenantId}: ${(err as Error).message}`);
      }
    }
    return { built, failed };
  }
}
