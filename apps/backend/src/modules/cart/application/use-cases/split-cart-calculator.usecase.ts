// SSOT Phase 011 §5.1 — Split-cart calculator use-case (read-model boundary)
// Canonical: apps/backend/src/modules/cart/application/use-cases/split-cart-calculator.usecase.ts
import { Injectable } from '@nestjs/common';
import type { HybridCartSplitSummary } from '@repo/shared';
import { CartService } from '../cart.service';

@Injectable()
export class SplitCartCalculatorUseCase {
  constructor(private readonly cart: CartService) {}

  execute(userId: string, shippingAddressId?: string, tenantId = 'default'): Promise<HybridCartSplitSummary> {
    return this.cart.getCalculatedCart(userId, shippingAddressId, tenantId);
  }
}
