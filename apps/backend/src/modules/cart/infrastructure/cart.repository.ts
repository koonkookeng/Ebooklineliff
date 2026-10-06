// SSOT Phase 011 §5.1 — Cart Prisma repository (atomic upserts, activity touch)
// Canonical: apps/backend/src/modules/cart/infrastructure/cart.repository.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { assertAddable, assertCartQuantity } from '../domain/entities/cart-item.entity';

const ITEM_INCLUDE = {
  product: {
    select: {
      id: true,
      title: true,
      coverImageUrl: true,
      productType: true,
      price: true,
      discountPrice: true,
      isPublished: true,
      deletedAt: true,
      physicalDetail: { select: { stockQty: true, reservedQty: true, weightGrams: true, sku: true } },
    },
  },
} as const;

export interface CartItemWithProduct {
  id: string;
  productId: string;
  quantity: number;
  itemCategory: string;
  product: {
    id: string;
    title: string;
    coverImageUrl: string;
    productType: string;
    price: unknown;
    discountPrice: unknown | null;
    isPublished: boolean;
    deletedAt: Date | null;
    physicalDetail: { stockQty: number; reservedQty: number; weightGrams: number; sku: string } | null;
  };
}

export interface CartWithItems {
  id: string;
  userId: string;
  tenantId: string;
  lastActivityAt: Date;
  items: CartItemWithProduct[];
}

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Get-or-create the user's single cart (userId unique) + touch activity. */
  async getOrCreate(userId: string, tenantId?: string): Promise<CartWithItems> {
    if (!userId) throw new BadRequestException('Missing user id');
    const existing = await this.prisma.cart
      .findUnique({ where: { userId }, include: { items: { include: ITEM_INCLUDE } } })
      .catch(() => null);
    if (existing) {
      await this.prisma.cart
        .update({ where: { id: existing.id }, data: { lastActivityAt: new Date() } })
        .catch(() => null);
      return existing as unknown as CartWithItems;
    }
    const created = await this.prisma.cart.create({
      data: { userId, tenantId: tenantId ?? 'default' },
      include: { items: { include: ITEM_INCLUDE } },
    });
    return created as unknown as CartWithItems;
  }

  /** Add item atomically: validates purchasability + stock inside a transaction. */
  async addItem(userId: string, productId: string, quantity: number, tenantId?: string): Promise<CartWithItems> {
    assertCartQuantity(quantity);
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.ensureCartTx(tx as never, userId, tenantId);
      const product = await (tx as unknown as { product: { findUnique: (args: unknown) => Promise<CartItemWithProduct['product'] | null> } }).product
        .findUnique({
          where: { id: productId },
          select: (ITEM_INCLUDE as { product: unknown }).product,
        });
      if (!product) throw new NotFoundException('Product not found');
      assertAddable(product, quantity);
      const txCart = tx as unknown as {
        cartItem: {
          upsert: (args: unknown) => Promise<unknown>;
          findUnique: (args: unknown) => Promise<{ quantity: number } | null>;
          update: (args: unknown) => Promise<unknown>;
        };
      };
      const prev = await txCart.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } } });
      const nextQty = (prev?.quantity ?? 0) + quantity;
      assertAddable(product, nextQty);
      await txCart.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId } },
        create: { cartId: cart.id, productId, quantity, itemCategory: 'DIGITAL' },
        update: { quantity: nextQty },
      });
      await (tx as unknown as { cart: { update: (args: unknown) => Promise<unknown> } }).cart.update({
        where: { id: cart.id },
        data: { lastActivityAt: new Date() },
      });
      return this.readCartTx(tx as never, cart.id);
    });
  }

  async updateQuantity(userId: string, cartItemId: string, quantity: number): Promise<CartWithItems> {
    assertCartQuantity(quantity);
    return this.prisma.$transaction(async (tx) => {
      const item = await this.findOwnedItemTx(tx as never, userId, cartItemId);
      assertAddable(
        {
          productType: item.product.productType,
          isPublished: item.product.isPublished,
          deletedAt: item.product.deletedAt,
          physicalDetail: item.product.physicalDetail
            ? { stockQty: item.product.physicalDetail.stockQty, reservedQty: item.product.physicalDetail.reservedQty }
            : null,
        },
        quantity,
      );
      await (tx as unknown as { cartItem: { update: (args: unknown) => Promise<unknown> } }).cartItem.update({
        where: { id: cartItemId },
        data: { quantity },
      });
      await (tx as unknown as { cart: { update: (args: unknown) => Promise<unknown> } }).cart.update({
        where: { id: item.cartId },
        data: { lastActivityAt: new Date() },
      });
      return this.readCartTx(tx as never, item.cartId);
    });
  }

  async removeItem(userId: string, cartItemId: string): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const item = await this.findOwnedItemTx(tx as never, userId, cartItemId);
      await (tx as unknown as { cartItem: { delete: (args: unknown) => Promise<unknown> } }).cartItem.delete({
        where: { id: cartItemId },
      });
      await (tx as unknown as { cart: { update: (args: unknown) => Promise<unknown> } }).cart.update({
        where: { id: item.cartId },
        data: { lastActivityAt: new Date() },
      });
      return this.readCartTx(tx as never, item.cartId);
    });
  }

  async read(userId: string): Promise<CartWithItems | null> {
    const cart = await this.prisma.cart
      .findUnique({ where: { userId }, include: { items: { include: ITEM_INCLUDE } } })
      .catch(() => null);
    return (cart as unknown as CartWithItems | null) ?? null;
  }

  private async ensureCartTx(tx: never, userId: string, tenantId?: string): Promise<{ id: string }> {
    const api = tx as unknown as {
      cart: {
        findUnique: (args: unknown) => Promise<{ id: string } | null>;
        create: (args: unknown) => Promise<{ id: string }>;
      };
    };
    const found = await api.cart.findUnique({ where: { userId } });
    if (found) return found;
    return api.cart.create({ data: { userId, tenantId: tenantId ?? 'default' } });
  }

  private async findOwnedItemTx(
    tx: never,
    userId: string,
    cartItemId: string,
  ): Promise<{ cartId: string; product: CartItemWithProduct['product'] }> {
    const api = tx as unknown as {
      cartItem: {
        findUnique: (args: unknown) => Promise<{ cartId: string; product: CartItemWithProduct['product']; cart: { userId: string } } | null>;
      };
    };
    const item = await api.cartItem.findUnique({
      where: { id: cartItemId },
      include: { product: { select: (ITEM_INCLUDE as { product: unknown }).product }, cart: { select: { userId: true } } },
    });
    if (!item || item.cart.userId !== userId) throw new NotFoundException('Cart item not found');
    return item;
  }

  private async readCartTx(tx: never, cartId: string): Promise<CartWithItems> {
    const api = tx as unknown as {
      cart: { findUnique: (args: unknown) => Promise<CartWithItems | null> };
    };
    const cart = await api.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: ITEM_INCLUDE } },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    return cart;
  }
}
