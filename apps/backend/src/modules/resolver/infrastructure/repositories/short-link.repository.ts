// SSOT Phase 025 §4.1/§5.2 — Short-link Prisma repository (atomic writes only)
// Canonical: apps/backend/src/modules/resolver/infrastructure/repositories/short-link.repository.ts
// (legacy src/backend/modules/resolver/infrastructure/repositories/short-link.repository.ts)
// - Zero new deps. Click counting uses atomic `increment` (no read-modify-write race).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type { DeepLinkTargetType } from '@repo/shared';

export interface CreateShortLinkRow {
  tenantId: string;
  shortCode: string;
  targetType: DeepLinkTargetType;
  targetId: string;
  customPath: string;
  affiliateCode?: string;
  campaignId?: string;
  couponCode?: string;
  signature: string;
  maxRedemptions?: number;
  expiresAt?: Date;
}

@Injectable()
export class ShortLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(shortCode: string) {
    return this.prisma.shortLink.findUnique({ where: { shortCode } });
  }

  create(row: CreateShortLinkRow) {
    return this.prisma.shortLink.create({
      data: {
        tenantId: row.tenantId,
        shortCode: row.shortCode,
        targetType: row.targetType,
        targetId: row.targetId,
        customPath: row.customPath,
        affiliateCode: row.affiliateCode,
        campaignId: row.campaignId,
        couponCode: row.couponCode,
        signature: row.signature,
        maxRedemptions: row.maxRedemptions,
        expiresAt: row.expiresAt,
      },
    });
  }

  incrementClicks(id: string) {
    return this.prisma.shortLink.update({
      where: { id },
      data: { clickCount: { increment: 1 } },
      select: { id: true, clickCount: true },
    });
  }

  logClick(args: {
    shortLinkId: string;
    environment: string;
    ipAddress: string;
    userAgent: string;
    referer?: string;
  }) {
    return this.prisma.deepLinkLog.create({ data: args });
  }

  /** Upsert affiliate touchpoint (one row per user+tenant; latest touch wins). */
  upsertAttribution(args: {
    userId: string;
    affiliateCode: string;
    tenantId: string;
    touchpointUrl: string;
    expiresAt: Date;
  }) {
    return this.prisma.affiliateAttribution.upsert({
      where: { userId_tenantId: { userId: args.userId, tenantId: args.tenantId } },
      create: args,
      update: {
        affiliateCode: args.affiliateCode,
        touchpointUrl: args.touchpointUrl,
        expiresAt: args.expiresAt,
      },
    });
  }
}
