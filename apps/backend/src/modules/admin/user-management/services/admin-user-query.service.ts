// SSOT Phase 109 §5.1 — Admin user query service (reads + detail + stats)
// Canonical: apps/backend/src/modules/admin/user-management/services/admin-user-query.service.ts
// - Zod-gated filters; Decimal/Date mapped to table-item wire shape.
// - Detail: user + KYC + last-20 wallet ledger + order aggregates.
// - Zero new deps.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminUserPrismaRepository } from '../repositories/admin-user-prisma.repository';
import { AdminUserTableItemSchema } from '@repo/shared';

@Injectable()
export class AdminUserQueryService {
  constructor(private readonly repo: AdminUserPrismaRepository) {}

  async listUsersAndMerchants(raw: unknown, tenantScope?: string) {
    const filter = { ...((raw ?? {}) as object), ...(tenantScope ? { tenantId: tenantScope } : {}) };
    const { items, total, page, pageSize, totalPages } = await this.repo.listUsersAndMerchants(filter);
    const mapped = (items as Array<Record<string, unknown>>).map((u) =>
      AdminUserTableItemSchema.parse({
        id: u['id'],
        lineUserId: (u['lineUserId'] as string | null) ?? null,
        email: (u['email'] as string | null) ?? null,
        phone: (u['phone'] as string | null) ?? null,
        displayName: u['displayName'],
        avatarUrl: (u['avatarUrl'] as string | null) ?? null,
        role: u['role'],
        kycStatus: u['kycStatus'],
        walletBalance: Number(u['walletBalance']),
        rewardPoints: u['rewardPoints'],
        affiliateCode: u['affiliateCode'],
        totalOrdersCount: u['totalOrdersCount'],
        totalSpentAmount: Number(u['totalSpentAmount']),
        createdAt: (u['createdAt'] as Date).toISOString(),
        updatedAt: (u['updatedAt'] as Date).toISOString(),
      }),
    );
    const summaryStats = await this.repo.getSummaryStats(
      (filter as { tenantId?: string }).tenantId,
    );
    return { items: mapped, totalCount: total, page, pageSize, totalPages, summaryStats };
  }

  async getUserDetail(userId: string) {
    if (!userId) throw new BadRequestException('Missing userId');
    const user = await this.repo.prisma.user.findUnique({
      where: { id: userId },
      include: {
        kycDetail: true,
        walletAuditLedgers: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { orders: true, referrals: true } },
      },
    });
    if (!user) throw new NotFoundException(`ไม่พบข้อมูลผู้ใช้งานรหัส: ${userId}`);
    const spent = await this.repo.prisma.order.aggregate({
      where: { userId },
      _sum: { totalAmount: true },
    });
    return {
      ...user,
      walletBalance: user.walletBalance.toString(),
      walletAuditLedgers: user.walletAuditLedgers.map((l) => ({
        ...l,
        amountDelta: l.amountDelta.toString(),
        balanceBefore: l.balanceBefore.toString(),
        balanceAfter: l.balanceAfter.toString(),
      })),
      totalOrdersCount: user._count.orders,
      referralCount: user._count.referrals,
      totalSpentAmount: (spent._sum.totalAmount ?? 0).toString(),
    };
  }
}
