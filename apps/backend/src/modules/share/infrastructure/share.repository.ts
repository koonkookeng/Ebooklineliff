// SSOT Phase 080 §5.1 — Prisma share repository (structural, tenant-aware)
// Canonical: apps/backend/src/modules/share/infrastructure/share.repository.ts
// - recordClick runs create + clickCount increment in one $transaction
//   (Gate 7); the use-case owns the tx boundary via withTx.
// - estimatedEarnings aggregates the affiliate CommissionLog (APPROVED+PAID)
//   for the sharer — read-only reuse, never writes money (079 owns payout).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type {
  ShareProductRow,
  ShareEventRow,
  ShareUserRow,
  ShareRepository,
} from '../domain/share.repository';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

function toRepo(db: Db): ShareRepository {
  return {
    async findProduct(productId: string): Promise<ShareProductRow | null> {
      const p = (await db['product'].findUnique({ where: { id: productId } }).catch(() => null)) as {
        id: string; tenantId: string | null; title: string; description: string;
        coverImageUrl: string; price: unknown; discountPrice: unknown; productType: string;
      } | null;
      if (!p) return null;
      return {
        ...p,
        price: toNum(p.price),
        discountPrice: p.discountPrice == null ? null : toNum(p.discountPrice),
      };
    },

    async findUser(userId: string): Promise<ShareUserRow | null> {
      const u = (await db['user'].findUnique({ where: { id: userId } }).catch(() => null)) as ShareUserRow | null;
      return u ?? null;
    },

    async createShareEvent(args: {
      userId: string; productId: string; targetType: string; refToken: string;
    }): Promise<ShareEventRow> {
      const row = (await db['shareEvent'].create({ data: { ...args } })) as ShareEventRow;
      return row;
    },

    async findShareEventByRefToken(refToken: string): Promise<ShareEventRow | null> {
      const row = (await db['shareEvent'].findUnique({ where: { refToken } }).catch(() => null)) as ShareEventRow | null;
      return row ?? null;
    },

    async recordClick(args: {
      shareEventId: string; visitorLineId: string | null; ipAddress: string; userAgent: string;
    }): Promise<void> {
      await db['affiliateClick'].create({ data: { ...args } });
      await db['shareEvent'].update({
        where: { id: args.shareEventId },
        data: { clickCount: { increment: 1 } },
      });
    },

    async shareMetrics(args: { userId: string; productId: string | null }): Promise<{
      totalShares: number; totalClicks: number; conversions: number; estimatedEarnings: number;
    }> {
      const shareWhere: Record<string, unknown> = { userId: args.userId };
      if (args.productId) shareWhere['productId'] = args.productId;
      const [shares, clicks, conversions, earnings] = (await Promise.all([
        db['shareEvent'].count({ where: shareWhere }),
        db['shareEvent'].aggregate({ where: shareWhere, _sum: { clickCount: true } }),
        db['affiliateClick'].count({
          where: { isConverted: true, shareEvent: { userId: args.userId } },
        }),
        db['commissionLog'].aggregate({
          where: { beneficiaryId: args.userId, status: { in: ['APPROVED', 'PAID'] } },
          _sum: { commissionAmount: true },
        }),
      ]).catch(() => [0, { _sum: {} }, 0, { _sum: {} }])) as unknown as [
        number,
        { _sum: { clickCount: unknown } },
        number,
        { _sum: { commissionAmount: unknown } },
      ];
      return {
        totalShares: shares ?? 0,
        totalClicks: toNum(clicks._sum.clickCount),
        conversions: conversions ?? 0,
        estimatedEarnings: toNum(earnings._sum.commissionAmount),
      };
    },
  };
}

@Injectable()
export class PrismaShareRepository implements ShareRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): ShareRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): ShareRepository {
    return toRepo(tx as Db);
  }

  findProduct(productId: string) { return this.root.findProduct(productId); }
  findUser(userId: string) { return this.root.findUser(userId); }
  createShareEvent(args: { userId: string; productId: string; targetType: string; refToken: string }) {
    return this.root.createShareEvent(args);
  }
  findShareEventByRefToken(refToken: string) { return this.root.findShareEventByRefToken(refToken); }
  recordClick(args: { shareEventId: string; visitorLineId: string | null; ipAddress: string; userAgent: string }) {
    return this.root.recordClick(args);
  }
  shareMetrics(args: { userId: string; productId: string | null }) {
    return this.root.shareMetrics(args);
  }
}
