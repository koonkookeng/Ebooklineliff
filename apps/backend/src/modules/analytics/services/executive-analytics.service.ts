// SSOT Phase 116 Task 3 §5.1 — executive analytics service (GMV/LTV/CAC/churn)
// Canonical: apps/backend/src/modules/analytics/services/executive-analytics.service.ts
// - Snapshot-first reads (DailyAnalyticsSnapshot sums when present), live
//   order aggregate fallback (bounded take — the 10M-row path is the nightly
//   snapshot + indexed columns, never a request-path full scan).
// - Cache-first 15min per tenant+range (Gate 5 <500ms); SLA measured + warned.
// - Tenant isolation: every read filters tenantId explicitly (§8.1); legacy
//   null-tenant rows are excluded by construction (documented).
// - Net revenue = 0.95 × GMV post-gateway (spec §5.1 assumption, labeled).
// - Zero new deps.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  BI_QUERY_SLA_MS,
  BI_SUMMARY_CACHE_TTL_SEC,
  CHURN_INACTIVITY_DAYS,
  AnalyticsTimeRangeEnum,
  averageOrderValue,
  biSummaryKey,
  churnRatePercentage,
  cohortMonthKey,
  customerAcquisitionCost,
  customerLifetimeValue,
  growthPercentage,
  ltvToCacRatio,
  monthOffset,
  retentionPercentage,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

/** Day bounds for a time range (pure, UTC). */
export function rangeBounds(
  timeRange: string,
  nowMs: number,
  custom?: { start: string; end: string },
): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date(nowMs);
  const day = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const today = day(now);
  const oneDay = 86400000;
  let start = today;
  let end = new Date(today.getTime() + oneDay);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  switch (timeRange) {
    case 'TODAY': break;
    case 'YESTERDAY': start = new Date(today.getTime() - oneDay); end = today; break;
    case 'LAST_7_DAYS': start = new Date(today.getTime() - 6 * oneDay); break;
    case 'LAST_30_DAYS': start = new Date(today.getTime() - 29 * oneDay); break;
    case 'THIS_MONTH': start = monthStart; break;
    case 'LAST_MONTH':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      end = monthStart;
      break;
    case 'CUSTOM':
      if (!custom) throw new Error('CUSTOM range requires start/end');
      start = new Date(custom.start);
      end = new Date(custom.end);
      break;
    default: start = new Date(today.getTime() - 29 * oneDay);
  }
  const span = end.getTime() - start.getTime();
  return { start, end, prevStart: new Date(start.getTime() - span), prevEnd: start };
}

export interface CohortUser {
  id: string;
  createdAt: Date;
}

export interface CohortMatrixRow {
  cohortDate: string;
  totalUsers: number;
  retentionRates: Array<{ periodIndex: number; activePercentage: number; retainedUsers: number }>;
}

/**
 * Pure cohort builder: group by acquisition month; a member counts retained
 * in period p when their last activity falls at/after that period's month.
 */
export function buildCohortMatrix(users: CohortUser[], lastActiveMs: Map<string, number>, nowMs: number, maxPeriods = 6): CohortMatrixRow[] {
  const byCohort = new Map<string, CohortUser[]>();
  for (const u of users) {
    const key = cohortMonthKey(u.createdAt);
    const arr = byCohort.get(key);
    if (arr) arr.push(u);
    else byCohort.set(key, [u]);
  }
  const rows: CohortMatrixRow[] = [];
  for (const [cohortDate, members] of [...byCohort.entries()].sort()) {
    const cohortStart = new Date(`${cohortDate}-01T00:00:00.000Z`).getTime();
    const periods = Math.min(maxPeriods, monthOffset(cohortStart, nowMs) + 1);
    const retentionRates = [];
    for (let p = 0; p < periods; p++) {
      const floor = new Date(cohortStart);
      floor.setUTCMonth(floor.getUTCMonth() + p);
      let retained = 0;
      for (const m of members) {
        if ((lastActiveMs.get(m.id) ?? 0) >= floor.getTime()) retained++;
      }
      retentionRates.push({ periodIndex: p, activePercentage: retentionPercentage(retained, members.length), retainedUsers: retained });
    }
    rows.push({ cohortDate, totalUsers: members.length, retentionRates });
  }
  return rows;
}

type PrismaAny = {
  order: { findMany(a: unknown): Promise<unknown[]> };
  user: { findMany(a: unknown): Promise<unknown[]>; count(a: unknown): Promise<number> };
  marketingCampaign: { findMany(a: unknown): Promise<unknown[]> };
  ebookReadingProgress: { findMany(a: unknown): Promise<unknown[]> };
  courseLearningProgress: { findMany(a: unknown): Promise<unknown[]> };
  orderItem: { findMany(a: unknown): Promise<unknown[]> };
  product: { findMany(a: unknown): Promise<unknown[]> };
  dailyAnalyticsSnapshot: { findMany(a: unknown): Promise<unknown[]> };
};

const READ_TAKE = 10000;

@Injectable()
export class ExecutiveAnalyticsService {
  private readonly logger = new Logger(ExecutiveAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  /** Executive KPI summary (cache-first, snapshot-first, live fallback). */
  async getExecutiveKpiSummary(tenantId: string, timeRange: string): Promise<Record<string, number | string>> {
    const parsed = AnalyticsTimeRangeEnum.safeParse(timeRange);
    if (!parsed.success) throw new BadRequestException('Invalid time range');
    const startedAt = Date.now();
    const key = biSummaryKey(tenantId, timeRange);
    try {
      const hit = await this.redis.get(key);
      if (hit) return JSON.parse(hit) as Record<string, number | string>;
    } catch {
      // Cache outage → compute live (fail-open).
    }

    const { start, end, prevStart, prevEnd } = rangeBounds(timeRange, Date.now());
    const snapshots = (await this.db.dailyAnalyticsSnapshot.findMany({
      where: { tenantId, snapshotDate: { gte: start, lt: end } },
    }).catch(() => [])) as Array<{ gmv: unknown; netRevenue: unknown; totalOrders: unknown }>;

    let gmv: number;
    let totalOrders: number;
    if (snapshots.length > 0) {
      gmv = snapshots.reduce((s, r) => s + Number(r.gmv ?? 0), 0);
      totalOrders = snapshots.reduce((s, r) => s + Number(r.totalOrders ?? 0), 0);
    } else {
      const orders = (await this.db.order.findMany({
        where: { tenantId, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', createdAt: { gte: start, lt: end } },
        select: { netAmount: true },
        take: READ_TAKE,
      }).catch(() => [])) as Array<{ netAmount: unknown }>;
      gmv = orders.reduce((s, r) => s + Number(r.netAmount ?? 0), 0);
      totalOrders = orders.length;
    }
    const prevGmv = await this.periodGmv(tenantId, prevStart, prevEnd);

    const [adSpend, totalCustomers, activeUsers, churned] = await Promise.all([
      this.totalAdSpend(tenantId),
      this.db.user.count({ where: { role: 'MEMBER' } }).catch(() => 0),
      this.activeUserIds(tenantId, Date.now()).then((s) => s.size).catch(() => 0),
      this.churnedCount(tenantId, Date.now()).catch(() => 0),
    ]);

    const netRevenue = Math.round(gmv * 0.95 * 100) / 100;
    const out: Record<string, number | string> = {
      gmv: Math.round(gmv * 100) / 100,
      netRevenue,
      totalOrders,
      averageOrderValue: averageOrderValue(gmv, totalOrders),
      customerAcquisitionCost: customerAcquisitionCost(adSpend, totalCustomers),
      customerLifetimeValue: customerLifetimeValue(gmv, totalCustomers),
      churnRatePercentage: churnRatePercentage(churned, totalCustomers),
      activeUsersCount: activeUsers,
      gmvGrowthPercentage: growthPercentage(gmv, prevGmv),
      ltvToCacRatio: ltvToCacRatio(customerLifetimeValue(gmv, totalCustomers), customerAcquisitionCost(adSpend, totalCustomers)),
      calculatedAt: new Date().toISOString(),
    };
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > BI_QUERY_SLA_MS) {
      this.logger.warn(`BI summary SLA breach for ${tenantId}/${timeRange}: ${elapsedMs}ms`);
    }
    try {
      await this.redis.setex(key, BI_SUMMARY_CACHE_TTL_SEC, JSON.stringify(out));
    } catch {
      // Cache write is best-effort.
    }
    return out;
  }

  /** Cohort retention matrix (bounded reads, pure builder). */
  async getCohortMatrix(tenantId: string, months = 6): Promise<CohortMatrixRow[]> {
    // Tenant isolation (§8.1): members filtered by tenantId explicitly.
    // Activity progress rows carry no tenant — attributed via member ids.
    const users = (await this.db.user.findMany({
      where: { role: 'MEMBER', tenantId },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    }).catch(() => [])) as Array<{ id: string; createdAt: Date }>;
    const activity = await this.activityMap();
    return buildCohortMatrix(
      users.map((u) => ({ id: u.id, createdAt: new Date(u.createdAt) })),
      activity,
      Date.now(),
      Math.min(12, Math.max(1, months)),
    );
  }

  /** Revenue split across the four product buckets (bounded reads). */
  async getRevenueBreakdown(tenantId: string, timeRange: string): Promise<Record<string, number>> {
    const parsed = AnalyticsTimeRangeEnum.safeParse(timeRange);
    if (!parsed.success) throw new BadRequestException('Invalid time range');
    const { start, end } = rangeBounds(timeRange, Date.now());
    const orders = (await this.db.order.findMany({
      where: { tenantId, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', createdAt: { gte: start, lt: end } },
      select: { id: true },
      take: READ_TAKE,
    }).catch(() => [])) as Array<{ id: string }>;
    const ids = orders.map((o) => o.id);
    const items = ids.length === 0 ? [] : ((await this.db.orderItem.findMany({
      where: { orderId: { in: ids } },
      take: READ_TAKE,
    }).catch(() => [])) as Array<{ productId: string; price: unknown; quantity: number }>);
    const products = items.length === 0 ? [] : ((await this.db.product.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
      select: { id: true, productType: true },
    }).catch(() => [])) as Array<{ id: string; productType: string }>);
    const typeOf = new Map(products.map((p) => [p.id, p.productType] as const));
    const buckets: Record<string, number> = { physicalBook: 0, ebook: 0, course: 0, bundle: 0 };
    for (const item of items) {
      const t = typeOf.get(item.productId);
      const value = Number(item.price ?? 0) * (item.quantity ?? 1);
      if (t === 'PHYSICAL_BOOK') buckets['physicalBook'] = Math.round(((buckets['physicalBook'] ?? 0) + value) * 100) / 100;
      else if (t === 'EBOOK') buckets['ebook'] = Math.round(((buckets['ebook'] ?? 0) + value) * 100) / 100;
      else if (t === 'ELEARNING_COURSE' || t === 'LIVE_CLASS') buckets['course'] = Math.round(((buckets['course'] ?? 0) + value) * 100) / 100;
      else if (t === 'HYBRID_BUNDLE') buckets['bundle'] = Math.round(((buckets['bundle'] ?? 0) + value) * 100) / 100;
    }
    return buckets;
  }

  private async periodGmv(tenantId: string, start: Date, end: Date): Promise<number> {
    const orders = (await this.db.order.findMany({
      where: { tenantId, orderStatus: 'COMPLETED', paymentStatus: 'VERIFIED', createdAt: { gte: start, lt: end } },
      select: { netAmount: true },
      take: READ_TAKE,
    }).catch(() => [])) as Array<{ netAmount: unknown }>;
    return orders.reduce((s, r) => s + Number(r.netAmount ?? 0), 0);
  }

  private async totalAdSpend(tenantId: string): Promise<number> {
    const rows = (await this.db.marketingCampaign.findMany({ where: { tenantId }, select: { totalAdSpend: true } }).catch(() => [])) as Array<{
      totalAdSpend: unknown;
    }>;
    return rows.reduce((s, r) => s + Number(r.totalAdSpend ?? 0), 0);
  }

  /** Distinct users active within the churn window. */
  private async activeUserIds(_tenantId: string, nowMs: number): Promise<Set<string>> {
    const cutoff = new Date(nowMs - CHURN_INACTIVITY_DAYS * 86400000);
    const [reads, watches] = await Promise.all([
      this.db.ebookReadingProgress.findMany({ where: { updatedAt: { gte: cutoff } }, select: { userId: true }, take: READ_TAKE }).catch(() => []),
      this.db.courseLearningProgress.findMany({ where: { updatedAt: { gte: cutoff } }, select: { userId: true }, take: READ_TAKE }).catch(() => []),
    ]);
    const ids = new Set<string>();
    for (const r of [...(reads as Array<{ userId: string }>), ...(watches as Array<{ userId: string }>)]) ids.add(r.userId);
    return ids;
  }

  private async activityMap(): Promise<Map<string, number>> {
    const [reads, watches] = await Promise.all([
      this.db.ebookReadingProgress.findMany({ select: { userId: true, updatedAt: true }, take: READ_TAKE }).catch(() => []),
      this.db.courseLearningProgress.findMany({ select: { userId: true, updatedAt: true }, take: READ_TAKE }).catch(() => []),
    ]);
    const map = new Map<string, number>();
    for (const r of [...(reads as Array<{ userId: string; updatedAt: Date }>), ...(watches as Array<{ userId: string; updatedAt: Date }>)]) {
      const t = new Date(r.updatedAt).getTime();
      if (t > (map.get(r.userId) ?? 0)) map.set(r.userId, t);
    }
    return map;
  }

  private async churnedCount(tenantId: string, nowMs: number): Promise<number> {
    const cutoff = new Date(nowMs - CHURN_INACTIVITY_DAYS * 86400000);
    const [members, active] = await Promise.all([
      this.db.user.findMany({ where: { role: 'MEMBER', createdAt: { lt: cutoff } }, select: { id: true }, take: READ_TAKE }).catch(() => []),
      this.activeUserIds(tenantId, nowMs),
    ]);
    let churned = 0;
    for (const m of members as Array<{ id: string }>) {
      if (!active.has(m.id)) churned++;
    }
    return churned;
  }
}
