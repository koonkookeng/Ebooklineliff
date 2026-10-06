// SSOT Phase 012 §5/BDD — Checkout service (atomic order + PromptPay payload, <1s write path)
// Canonical: apps/backend/src/modules/order/services/checkout.service.ts
// Totals: list-price snapshot at purchase; shipping via live cheapest quote;
// coupons recorded but valued by the promotion engine (Phase 088/117) — 0 here.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  CreateOrderInputSchema,
  generateOrderNumber,
  promptPayExpiry,
  type CreateOrderInput,
  type CreateOrderPayload,
} from '@repo/shared';
import { ShippingAdapterService } from '../../cart/infrastructure/shipping-adapter.service';
import { buildPromptPayPayload, type PromptPayProxyType } from '../../payment/services/promptpay-emv.builder';

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

function merchantTarget(): { proxyType: PromptPayProxyType; proxyValue: string } {
  const proxyValue = process.env.COMPANY_PROMPTPAY_ID ?? '';
  const proxyType = (process.env.COMPANY_PROMPTPAY_TYPE ?? 'MOBILE') as PromptPayProxyType;
  if (!proxyValue) throw new BadRequestException('Merchant PromptPay account is not configured');
  return { proxyType, proxyValue };
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly shipping: ShippingAdapterService,
  ) {}

  /** Atomic checkout: price snapshot + stock guard + order/items + cart clear + QR payload. */
  async createOrder(userId: string, raw: CreateOrderInput): Promise<CreateOrderPayload> {
    if (!userId) throw new BadRequestException('Missing user id');
    const parsed = CreateOrderInputSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid checkout payload');
    const input = parsed.data;

    const products = await this.prisma.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) } },
      select: {
        id: true, title: true, productType: true, price: true, discountPrice: true,
        isPublished: true, deletedAt: true,
        physicalDetail: { select: { stockQty: true, reservedQty: true, weightGrams: true } },
      },
    });
    if (products.length !== input.items.length) throw new NotFoundException('One or more products not found');

    let totalAmount = 0;
    let totalWeight = 0;
    const lines = input.items.map((item) => {
      const p = products.find((x) => x.id === item.productId);
      if (!p || !p.isPublished || p.deletedAt) throw new BadRequestException(`Product unavailable: ${item.productId}`);
      if (p.physicalDetail) {
        const available = p.physicalDetail.stockQty - p.physicalDetail.reservedQty;
        if (available < item.quantity) throw new BadRequestException(`Insufficient stock: ${p.title}`);
        totalWeight += p.physicalDetail.weightGrams * item.quantity;
      }
      const unit = p.discountPrice !== null && Number(p.discountPrice) < Number(p.price)
        ? toNum(p.discountPrice, 0)
        : toNum(p.price, 0);
      totalAmount += unit * item.quantity;
      return { productId: p.id, price: unit, quantity: item.quantity };
    });

    let shippingFee = 0;
    if (totalWeight > 0) {
      if (!input.shippingAddressId) throw new BadRequestException('Shipping address is required for physical items');
      const address = await this.prisma.userAddress
        .findUnique({ where: { id: input.shippingAddressId } })
        .catch(() => null);
      if (!address || address.userId !== userId) throw new BadRequestException('Invalid shipping address');
      shippingFee = (await this.shipping.cheapest(address.postalCode, totalWeight)).fee;
    }

    const discountAmount = 0;
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const netAmount = round2(totalAmount - discountAmount + shippingFee);

    const created = await this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as {
        order: { create: (args: unknown) => Promise<{ id: string; orderNumber: string }> };
        cart: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
        cartItem: { deleteMany: (args: unknown) => Promise<unknown> };
      };
      let orderNumber = generateOrderNumber();
      let order: { id: string; orderNumber: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          order = await db.order.create({
            data: {
              tenantId: input.tenantId,
              orderNumber,
              userId,
              totalAmount: round2(totalAmount),
              shippingFee,
              discountAmount,
              netAmount,
              orderStatus: 'PENDING_PAYMENT',
              paymentStatus: 'UNPAID',
              orderItems: { create: lines },
            },
            select: { id: true, orderNumber: true },
          });
          break;
        } catch (e) {
          if ((e as { code?: string }).code === 'P2002' && attempt < 2) {
            orderNumber = generateOrderNumber();
            continue;
          }
          throw e;
        }
      }
      if (!order) throw new BadRequestException('Failed to create order');
      const cart = await db.cart.findUnique({ where: { userId } });
      if (cart) {
        await db.cartItem.deleteMany({
          where: { cartId: cart.id, productId: { in: input.items.map((i) => i.productId) } },
        });
      }
      return order;
    });

    const target = merchantTarget();
    const promptPayQrPayload = buildPromptPayPayload(target, netAmount, created.orderNumber);
    const expiresAt = promptPayExpiry();
    await this.redis
      .publish('stream:order:created', JSON.stringify({ orderId: created.id, userId, netAmount, at: new Date().toISOString() }))
      .catch(() => undefined);
    return { orderId: created.id, orderNumber: created.orderNumber, netAmount, promptPayQrPayload, expiresAt };
  }

  /** Owner-guarded order read with denormalized item titles (GQL Order type). */
  async getOrder(userId: string, orderId: string) {
    const order = await this.prisma.order
      .findUnique({
        where: { id: orderId },
        include: { orderItems: { include: { product: { select: { title: true, productType: true } } } }, paymentSlip: true },
      })
      .catch(() => null);
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    return {
      ...order,
      totalAmount: toNum(order.totalAmount, 0),
      shippingFee: toNum(order.shippingFee, 0),
      discountAmount: toNum(order.discountAmount, 0),
      netAmount: toNum(order.netAmount, 0),
      orderItems: order.orderItems.map((it) => ({
        id: it.id,
        orderId: it.orderId,
        productId: it.productId,
        productTitle: it.product.title,
        productType: it.product.productType,
        price: toNum(it.price, 0),
        quantity: it.quantity,
      })),
    };
  }
}
