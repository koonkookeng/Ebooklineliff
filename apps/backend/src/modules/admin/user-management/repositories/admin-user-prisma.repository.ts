// SSOT Phase 109 §5.1 — Admin user structural Prisma repository
// Canonical: apps/backend/src/modules/admin/user-management/repositories/admin-user-prisma.repository.ts
// - Indexed universal query (tenantId / [role,kycStatus] / createdAt /
//   walletBalance / displayName). Sort column whitelisted (no injection).
// - Redis: 30s list cache + 60s stats (dashboard <50ms, §7.1).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import {
  UserMerchantFilterSchema,
  ADMIN_LIST_CACHE_TTL_SEC,
  ADMIN_STATS_TTL_SEC,
  adminUsersCacheKey,
  adminStatsKey,
  type UserMerchantFilter,
} from '@repo/shared';

const SORT_COLUMN: Record<string, string> = {
  createdAt: 'createdAt',
  displayName: 'displayName',
  walletBalance: 'walletBalance',
  rewardPoints: 'rewardPoints',
};

@Injectable()
export class AdminUserPrismaRepository {
  constructor(
    public readonly prisma: PrismaService,
    public readonly redis: RedisClusterService,
  ) {}

  buildWhere(filter: UserMerchantFilter): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (filter.tenantId) where['tenantId'] = filter.tenantId;
    if (filter.role?.length) where['role'] = { in: filter.role };
    if (filter.kycStatus?.length) where['kycStatus'] = { in: filter.kycStatus };
    if (filter.minWalletBalance !== undefined || filter.maxWalletBalance !== undefined) {
      const walletBalance: Record<string, number> = {};
      if (filter.minWalletBalance !== undefined) walletBalance['gte'] = filter.minWalletBalance;
      if (filter.maxWalletBalance !== undefined) walletBalance['lte'] = filter.maxWalletBalance;
      where['walletBalance'] = walletBalance;
    }
    if (filter.hasAffiliateReferrals === true) {
      where['referrals'] = { some: {} };
    }
    if (filter.createdFrom || filter.createdTo) {
      const createdAt: Record<string, Date> = {};
      if (filter.createdFrom) createdAt['gte'] = new Date(filter.createdFrom);
      if (filter.createdTo) createdAt['lte'] = new Date(filter.createdTo);
      where['createdAt'] = createdAt;
    }
    const kw = filter.searchKeyword?.trim();
    if (kw) {
      where['OR'] = [
        { displayName: { contains: kw, mode: 'insensitive' } },
        { email: { contains: kw, mode: 'insensitive' } },
        { phone: { contains: kw, mode: 'insensitive' } },
        { lineUserId: { contains: kw, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async listUsersAndMerchants(raw: unknown) {
    const filter = UserMerchantFilterSchema.parse(raw);
    const cacheKey = adminUsersCacheKey(filter as unknown as Record<string, unknown>);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number };

    const where = this.buildWhere(filter);
    const orderBy = { [SORT_COLUMN[filter.sortBy] ?? 'createdAt']: filter.sortOrder };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Per-page order aggregates in 1 grouped query (no N+1).
    const ids = rows.map((u) => u.id);
    const stats =
      ids.length > 0
        ? await this.prisma.order.groupBy({
            by: ['userId'],
            where: { userId: { in: ids } },
            _count: { _all: true },
            _sum: { totalAmount: true },
          })
        : [];
    const byUser = new Map(stats.map((s) => [s.userId, s]));
    const items = rows.map((u) => {
      const s = byUser.get(u.id);
      return {
        ...u,
        walletBalance: u.walletBalance.toString(),
        totalOrdersCount: s?._count._all ?? 0,
        totalSpentAmount: s?._sum.totalAmount?.toString() ?? '0',
      };
    });
    const payload = {
      items,
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      totalPages: Math.ceil(total / filter.pageSize),
    };
    await this.redis.setex(cacheKey, ADMIN_LIST_CACHE_TTL_SEC, JSON.stringify(payload)).catch(() => undefined);
    return payload;
  }

  async getSummaryStats(tenantId?: string) {
    const cacheKey = adminStatsKey(tenantId);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, number>;

    const scope = tenantId ? { tenantId } : {};
    const [totalUsers, totalSellers, totalInstructors, pendingKYCCount, circulation] = await Promise.all([
      this.prisma.user.count({ where: scope }),
      this.prisma.user.count({ where: { ...scope, role: 'SELLER' } }),
      this.prisma.user.count({ where: { ...scope, role: 'INSTRUCTOR' } }),
      this.prisma.user.count({ where: { ...scope, kycStatus: 'PENDING' } }),
      this.prisma.user.aggregate({ where: scope, _sum: { walletBalance: true } }),
    ]);
    const stats = {
      totalUsers,
      totalSellers,
      totalInstructors,
      pendingKYCCount,
      totalWalletCirculation: Number(circulation._sum.walletBalance ?? 0),
    };
    await this.redis.setex(cacheKey, ADMIN_STATS_TTL_SEC, JSON.stringify(stats)).catch(() => undefined);
    return stats;
  }

  async invalidateListCaches(tenantId?: string): Promise<void> {
    const keys = await this.redis.scanKeys('admin:users:*').catch(() => [] as string[]);
    if (keys.length > 0) await this.redis.del(...keys).catch(() => undefined);
    await this.redis.del(adminStatsKey(tenantId), adminStatsKey(undefined)).catch(() => undefined);
  }
}
