// SSOT Phase 108 §5.2 — Tenant Quota Enforcer Service
// Canonical: apps/backend/src/modules/tenant-orchestration/services/tenant-quota-enforcer.service.ts
// - Real-time quota checks: users, storage (R2), MAU, API calls.
// - Predictive alerts at 90% threshold (§7.1).
// - Records daily usage metrics to Redis TimeSeries + PostgreSQL.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  max: number;
  percentage: number;
  warning: boolean;
}

export interface UsageMetrics {
  activeUsers: number;
  storageBytes: bigint;
  monthlyLiffMAU: number;
  apiCalls: number;
}

@Injectable()
export class TenantQuotaEnforcerService {
  private readonly logger = new Logger(TenantQuotaEnforcerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  async checkUserQuota(tenantId: string): Promise<QuotaCheckResult> {
    const tenant = await this.prisma.tenantCompany.findUnique({
      where: { id: tenantId },
      select: { maxUsers: true, packageTier: true },
    });
    if (!tenant) throw new Error('Tenant not found');

    const current = await this.prisma.user.count({
      where: { tenantId },
    });
    const max = tenant.maxUsers;
    const percentage = max > 0 ? (current / max) * 100 : 0;

    return {
      allowed: current < max,
      current,
      max,
      percentage: Math.round(percentage * 100) / 100,
      warning: percentage >= 90,
    };
  }

  async checkStorageQuota(tenantId: string): Promise<QuotaCheckResult> {
    const tenant = await this.prisma.tenantCompany.findUnique({
      where: { id: tenantId },
      select: { maxStorageBytes: true },
    });
    if (!tenant) throw new Error('Tenant not found');

    const usage = await this.prisma.tenantUsageMetric.aggregate({
      where: { tenantId },
      _sum: { storageBytesUsed: true },
    });
    const current = usage._sum.storageBytesUsed ?? 0n;
    const max = tenant.maxStorageBytes;
    const percentage = max > 0n ? Number((current * 100n) / max) : 0;

    return {
      allowed: current < max,
      current: Number(current),
      max: Number(max),
      percentage,
      warning: percentage >= 90,
    };
  }

  async checkMAUQuota(tenantId: string): Promise<QuotaCheckResult> {
    const tenant = await this.prisma.tenantCompany.findUnique({
      where: { id: tenantId },
      select: { maxMonthlyLiffMAU: true },
    });
    if (!tenant) throw new Error('Tenant not found');

    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const metric = await this.prisma.tenantUsageMetric.findFirst({
      where: {
        tenantId,
        recordedDate: { gte: currentMonth },
      },
      orderBy: { recordedDate: 'desc' },
    });
    const current = metric?.liffSessionsCount ?? 0;
    const max = tenant.maxMonthlyLiffMAU;
    const percentage = max > 0 ? (current / max) * 100 : 0;

    return {
      allowed: current < max,
      current,
      max,
      percentage: Math.round(percentage * 100) / 100,
      warning: percentage >= 90,
    };
  }

  async recordUsage(tenantId: string, metrics: Partial<UsageMetrics>) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.tenantUsageMetric.upsert({
      where: { tenantId_recordedDate: { tenantId, recordedDate: today } },
      create: {
        tenantId,
        recordedDate: today,
        activeUsersCount: metrics.activeUsers ?? 0,
        storageBytesUsed: metrics.storageBytes ?? 0n,
        apiCallsCount: metrics.apiCalls ?? 0,
        liffSessionsCount: metrics.monthlyLiffMAU ?? 0,
      },
      update: {
        activeUsersCount: { increment: metrics.activeUsers ?? 0 },
        storageBytesUsed: { increment: metrics.storageBytes ?? 0n },
        apiCallsCount: { increment: metrics.apiCalls ?? 0 },
        liffSessionsCount: { increment: metrics.monthlyLiffMAU ?? 0 },
      },
    });

    // Also push to Redis TimeSeries for real-time analytics (§7.1)
    const tsKey = `tenant:usage:${tenantId}:${today.toISOString().split('T')[0]}`;
    await this.redis.xaddPipeline('tenant:usage:metrics', [
      { tenantId, metric: 'users', value: metrics.activeUsers ?? 0, timestamp: Date.now() },
      { tenantId, metric: 'storage', value: Number(metrics.storageBytes ?? 0n), timestamp: Date.now() },
      { tenantId, metric: 'mau', value: metrics.monthlyLiffMAU ?? 0, timestamp: Date.now() },
      { tenantId, metric: 'api', value: metrics.apiCalls ?? 0, timestamp: Date.now() },
    ]).catch(() => {}); // Best-effort

    // Predictive quota alert at 90% (§7.1)
    await this.checkAndAlertQuota(tenantId);
  }

  async checkAndAlertQuota(tenantId: string) {
    const tenant = await this.prisma.tenantCompany.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) return;

    const [userCheck, storageCheck, mauCheck] = await Promise.all([
      this.checkUserQuota(tenantId),
      this.checkStorageQuota(tenantId),
      this.checkMAUQuota(tenantId),
    ]);

    const alerts = [];
    if (userCheck.warning) alerts.push(`User quota at ${userCheck.percentage}%`);
    if (storageCheck.warning) alerts.push(`Storage quota at ${storageCheck.percentage}%`);
    if (mauCheck.warning) alerts.push(`MAU quota at ${mauCheck.percentage}%`);

    if (alerts.length > 0) {
      this.logger.warn(`Tenant ${tenantId} quota alerts: ${alerts.join(', ')}`);
      // Emit to analytics stream for LINE Flex/Email notification (§7.1)
      await this.redis.xaddPipeline('tenant:quota:alerts', [{
        tenantId,
        alerts: JSON.stringify(alerts),
        timestamp: Date.now(),
      }]).catch(() => {});
    }
  }

  async getAllQuotaStatus(tenantId: string) {
    const [users, storage, mau] = await Promise.all([
      this.checkUserQuota(tenantId),
      this.checkStorageQuota(tenantId),
      this.checkMAUQuota(tenantId),
    ]);
    return { users, storage, mau };
  }

  async getUsageHistory(tenantId: string, days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);

    return this.prisma.tenantUsageMetric.findMany({
      where: {
        tenantId,
        recordedDate: { gte: from },
      },
      orderBy: { recordedDate: 'asc' },
    });
  }
}