// SSOT Phase 011 §5.1 — Add-to-cart use-case (thin boundary: Zod in, summary out)
// Canonical: apps/backend/src/modules/cart/application/use-cases/add-to-cart.usecase.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { AddToCartInputSchema, type HybridCartSplitSummary } from '@repo/shared';
import { CartService } from '../cart.service';

@Injectable()
export class AddToCartUseCase {
  constructor(private readonly cart: CartService) {}

  execute(userId: string, raw: { productId: string; quantity?: number }, tenantId = 'default'): Promise<HybridCartSplitSummary> {
    const parsed = AddToCartInputSchema.safeParse({ productId: raw.productId, quantity: raw.quantity ?? 1 });
    if (!parsed.success) throw new BadRequestException('Invalid add-to-cart payload');
    return this.cart.addToCart(userId, parsed.data.productId, parsed.data.quantity, tenantId);
  }
}
