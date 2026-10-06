// SSOT Phase 011 §5.2 — Cart domain service (hybrid split + shipping + analytics events)
// Canonical: apps/backend/src/modules/cart/application/cart.service.ts
// (legacy src/backend/modules/cart/application/cart.service.ts)
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  HybridCartSplitSummarySchema,
  effectiveUnitPrice,
  type Carrier,
  type HybridCartSplitSummary,
  type SmartCartItem,
} from '@repo/shared';
import { CartRepository } from '../infrastructure/cart.repository';
import { ShippingAdapterService } from '../infrastructure/shipping-adapter.service';
import { deriveItemCategory } from '../domain/entities/cart-item.entity';
import { emptyCartSummary, splitCart } from '../domain/value-objects/cart-split.vo';

const toNum = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return (v as { toNumber(): number }).toNumber() ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

@Injectable()
export class CartService {
  constructor(
    private readonly repo: CartRepository,
    private readonly shipping: ShippingAdapterService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private toSmartItem(row: {
    id: string;
    productId: string;
    quantity: number;
    product: {
      title: string;
      coverImageUrl: string;
      productType: string;
      price: unknown;
      discountPrice: unknown | null;
      physicalDetail: { weightGrams: number; sku: string } | null;
    };
  }): SmartCartItem {
    const physical = row.product.physicalDetail !== null;
    const category = deriveItemCategory(row.product.productType, physical);
    return {
      cartItemId: row.id,
      productId: row.productId,
      title: row.product.title,
      coverImageUrl: row.product.coverImageUrl,
      productType: row.product.productType as SmartCartItem['productType'],
      itemCategory: category,
      unitPrice: effectiveUnitPrice(
        toNum(row.product.price, 0),
        row.product.discountPrice === null ? null : toNum(row.product.discountPrice, 0),
      ),
      quantity: row.quantity,
      weightGrams: category === 'PHYSICAL' ? (row.product.physicalDetail?.weightGrams ?? 0) : 0,
      sku: row.product.physicalDetail?.sku,
    };
  }

  private async summarize(
    userId: string,
    tenantId: string,
    shippingFeeOverride?: number,
  ): Promise<HybridCartSplitSummary> {
    const cart = await this.repo.read(userId);
    if (!cart || cart.items.length === 0) return emptyCartSummary();
    const items = cart.items.map((r) => this.toSmartItem(r));
    const summary = splitCart(items, shippingFeeOverride ?? 0, 0);
    const parsed = HybridCartSplitSummarySchema.safeParse(summary);
    if (!parsed.success) throw new BadRequestException('Cart summary contract drift');
    return parsed.data;
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }

  /** BDD core: split cart + optional live shipping via address postal code. */
  async getCalculatedCart(userId: string, shippingAddressId?: string, tenantId = 'default'): Promise<HybridCartSplitSummary> {
    if (!userId) throw new BadRequestException('Missing user id');
    let fee = 0;
    if (shippingAddressId) {
      const address = await this.prisma.userAddress
        .findUnique({ where: { id: shippingAddressId } })
        .catch(() => null);
      if (!address) throw new NotFoundException('Shipping address not found');
      const base = await this.summarize(userId, tenantId, 0);
      if (base.totalPhysicalWeightGrams > 0) {
        const quote = await this.shipping.cheapest(address.postalCode, base.totalPhysicalWeightGrams);
        fee = quote.fee;
      }
      const summary = await this.summarize(userId, tenantId, fee);
      await this.emit('stream:cart:split-calculated', {
        userId, tenantId, digitalSubtotal: summary.digitalSubtotal,
        physicalSubtotal: summary.physicalSubtotal, shippingFee: fee,
      });
      return summary;
    }
    return this.summarize(userId, tenantId, 0);
  }

  async addToCart(userId: string, productId: string, quantity: number, tenantId = 'default'): Promise<HybridCartSplitSummary> {
    if (!userId) throw new BadRequestException('Missing user id');
    if (!productId) throw new BadRequestException('Missing product id');
    const cart = await this.repo.addItem(userId, productId, quantity, tenantId);
    const product = cart.items.find((i) => i.productId === productId)?.product;
    await this.emit('stream:cart:item-added', {
      userId, tenantId, productId, productType: product?.productType ?? 'UNKNOWN', quantity,
    });
    return this.summarize(userId, tenantId, 0);
  }

  async updateQuantity(userId: string, cartItemId: string, quantity: number, tenantId = 'default'): Promise<HybridCartSplitSummary> {
    if (!userId) throw new BadRequestException('Missing user id');
    await this.repo.updateQuantity(userId, cartItemId, quantity);
    return this.summarize(userId, tenantId, 0);
  }

  async removeItem(userId: string, cartItemId: string, tenantId = 'default'): Promise<HybridCartSplitSummary> {
    if (!userId) throw new BadRequestException('Missing user id');
    await this.repo.removeItem(userId, cartItemId);
    return this.summarize(userId, tenantId, 0);
  }

  /** Live carrier quotes for the cart's current physical weight (<300ms warm). */
  async calculateShipping(
    userId: string,
    shippingAddressId: string,
    preferredCarrier?: Carrier,
    tenantId = 'default',
  ): Promise<{ quotes: Array<{ carrier: Carrier; fee: number; estimatedDays: [number, number] }>; summary: HybridCartSplitSummary }> {
    const address = await this.prisma.userAddress
      .findUnique({ where: { id: shippingAddressId } })
      .catch(() => null);
    if (!address) throw new NotFoundException('Shipping address not found');
    if (address.userId !== userId) throw new BadRequestException('Address does not belong to user');
    const base = await this.summarize(userId, tenantId, 0);
    if (base.totalPhysicalWeightGrams === 0) {
      return { quotes: [], summary: base };
    }
    const quotes = await this.shipping.quoteAll(address.postalCode, base.totalPhysicalWeightGrams);
    const picked = preferredCarrier
      ? (quotes.find((q) => q.carrier === preferredCarrier) ?? quotes.reduce((a, b) => (b.fee < a.fee ? b : a)))
      : quotes.reduce((a, b) => (b.fee < a.fee ? b : a));
    const summary = await this.summarize(userId, tenantId, picked.fee);
    await this.emit('stream:cart:split-calculated', {
      userId, tenantId, digitalSubtotal: summary.digitalSubtotal,
      physicalSubtotal: summary.physicalSubtotal, shippingFee: picked.fee, carrier: picked.carrier,
    });
    return {
      quotes: quotes.map((q) => ({ carrier: q.carrier, fee: q.fee, estimatedDays: q.estimatedDays })),
      summary,
    };
  }
}
