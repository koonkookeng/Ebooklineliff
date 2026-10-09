// SSOT Phase 087 — Campaign service (UTC phase machine + item status)
// Canonical: apps/backend/src/modules/flash-sale/services/flash-sale-campaign.service.ts
// (legacy class name FlashSaleCampaignServiceService renamed — no importers.)
// - Active campaign per tenant (server-UTC overlap), item status with live
//   remaining + discount %, admin create/update (PAUSED control).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { campaignPhase, flashDiscountPct, flashRemaining } from '@repo/shared';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

@Injectable()
export class FlashSaleCampaignService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async activeCampaign(tenantId: string, now = Date.now()): Promise<{
    id: string; tenantId: string; title: string; description: string | null;
    startTime: string; endTime: string; status: string; serverCurrentTime: string;
    items: Array<{
      productId: string; productTitle: string; coverImageUrl: string;
      originalPrice: number; flashSalePrice: number; allocatedStock: number;
      soldQty: number; remainingStock: number; maxPerUser: number; discountPercentage: number;
    }>;
  } | null> {
    const row = (await this.db['flashSaleCampaign'].findFirst({
      where: {
        tenantId,
        status: { in: ['UPCOMING', 'ACTIVE', 'PAUSED'] },
        startTime: { lte: new Date(now) },
        endTime: { gt: new Date(now) },
      },
      include: { items: { include: { product: true } } },
      orderBy: { startTime: 'desc' },
    }).catch(() => null)) as {
      id: string; tenantId: string; title: string; description: string | null;
      startTime: Date; endTime: Date; status: string;
      items: Array<{
        productId: string; flashPrice: unknown; allocatedStock: number;
        reservedStock: number; soldQty: number; maxPerUser: number;
        product: { title: string; coverImageUrl: string; price: unknown };
      }>;
    } | null;
    if (!row) return null;
    const items = row.items.map((i) => {
      const original = toNum(i.product.price);
      const flash = toNum(i.flashPrice);
      return {
        productId: i.productId,
        productTitle: i.product.title,
        coverImageUrl: i.product.coverImageUrl,
        originalPrice: original,
        flashSalePrice: flash,
        allocatedStock: i.allocatedStock,
        soldQty: i.soldQty,
        remainingStock: flashRemaining(i.allocatedStock, i.reservedStock, i.soldQty),
        maxPerUser: i.maxPerUser,
        discountPercentage: flashDiscountPct(original, flash),
      };
    });
    const remaining = items.reduce((s, i) => s + i.remainingStock, 0);
    return {
      id: row.id,
      tenantId: row.tenantId,
      title: row.title,
      description: row.description,
      startTime: new Date(row.startTime).toISOString(),
      endTime: new Date(row.endTime).toISOString(),
      status: campaignPhase({
        status: row.status,
        startTime: new Date(row.startTime).getTime(),
        endTime: new Date(row.endTime).getTime(),
        remaining,
      }, now),
      serverCurrentTime: new Date(now).toISOString(),
      items,
    };
  }

  async itemStatus(campaignId: string, productId: string, now = Date.now()): Promise<{
    productId: string; productTitle: string; coverImageUrl: string;
    originalPrice: number; flashSalePrice: number; allocatedStock: number;
    soldQty: number; remainingStock: number; maxPerUser: number; discountPercentage: number;
  }> {
    const active = await this.activeCampaignById(campaignId, now);
    const item = active?.items.find((i) => i.productId === productId);
    if (!item) throw new BadRequestException('Flash sale item not found');
    return item;
  }

  private async activeCampaignById(campaignId: string, now: number): Promise<{ items: Array<{
    productId: string; productTitle: string; coverImageUrl: string;
    originalPrice: number; flashSalePrice: number; allocatedStock: number;
    soldQty: number; remainingStock: number; maxPerUser: number; discountPercentage: number;
  }> } | null> {
    const row = (await this.db['flashSaleCampaign'].findUnique({
      where: { id: campaignId },
      include: { items: { include: { product: true } } },
    }).catch(() => null)) as {
      items: Array<{
        productId: string; flashPrice: unknown; allocatedStock: number;
        reservedStock: number; soldQty: number; maxPerUser: number;
        product: { title: string; coverImageUrl: string; price: unknown };
      }>;
    } | null;
    if (!row) return null;
    return {
      items: row.items.map((i) => {
        const original = toNum(i.product.price);
        const flash = toNum(i.flashPrice);
        return {
          productId: i.productId,
          productTitle: i.product.title,
          coverImageUrl: i.product.coverImageUrl,
          originalPrice: original,
          flashSalePrice: flash,
          allocatedStock: i.allocatedStock,
          soldQty: i.soldQty,
          remainingStock: flashRemaining(i.allocatedStock, i.reservedStock, i.soldQty),
          maxPerUser: i.maxPerUser,
          discountPercentage: flashDiscountPct(original, flash),
        };
      }),
    };
  }

  async createCampaign(actorRole: string | undefined, body: {
    tenantId: string; title: string; description?: string; startTime: string; endTime: string;
    items: Array<{ productId: string; flashPrice: number; allocatedStock: number; maxPerUser?: number }>;
  }): Promise<{ id: string }> {
    if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'FINANCE_ADMIN' && actorRole !== 'CONTENT_MODERATOR') {
      throw new BadRequestException('Campaign management requires an admin role');
    }
    if (new Date(body.startTime).getTime() >= new Date(body.endTime).getTime()) {
      throw new BadRequestException('Campaign end must be after start');
    }
    const row = (await this.db['flashSaleCampaign'].create({
      data: {
        tenantId: body.tenantId,
        title: body.title,
        ...(body.description ? { description: body.description } : {}),
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        status: 'UPCOMING',
        items: {
          create: body.items.map((i) => ({
            productId: i.productId,
            flashPrice: i.flashPrice,
            allocatedStock: i.allocatedStock,
            maxPerUser: i.maxPerUser ?? 1,
          })),
        },
      },
    })) as { id: string };
    return { id: row.id };
  }

  async setStatus(actorRole: string | undefined, campaignId: string, status: 'PAUSED' | 'ACTIVE' | 'ENDED'): Promise<void> {
    if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'FINANCE_ADMIN' && actorRole !== 'CONTENT_MODERATOR') {
      throw new BadRequestException('Campaign management requires an admin role');
    }
    await this.db['flashSaleCampaign'].update({ where: { id: campaignId }, data: { status } });
  }
}
