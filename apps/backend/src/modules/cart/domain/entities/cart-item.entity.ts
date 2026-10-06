// SSOT Phase 011 §5.1 — Cart item entity invariants (pure; Prisma row in, decisions out)
// Canonical: apps/backend/src/modules/cart/domain/entities/cart-item.entity.ts
import { BadRequestException } from '@nestjs/common';

export interface CartItemRow {
  id: string;
  productId: string;
  quantity: number;
  itemCategory: string;
  product: {
    productType: string;
    isPublished: boolean;
    deletedAt: Date | null;
    physicalDetail: { stockQty: number; reservedQty: number } | null;
  };
}

/** Quantity guards: 1..99, integer (fail-fast with context). */
export function assertCartQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new BadRequestException('Quantity must be an integer between 1 and 99');
  }
}

/** Add-to-cart guards: published, not deleted, physical stock covers qty. */
export function assertAddable(row: CartItemRow['product'], quantity: number): void {
  assertCartQuantity(quantity);
  if (!row.isPublished || row.deletedAt) {
    throw new BadRequestException('Product is not available for purchase');
  }
  if (row.physicalDetail) {
    const available = row.physicalDetail.stockQty - row.physicalDetail.reservedQty;
    if (available < quantity) {
      throw new BadRequestException('Insufficient stock for requested quantity');
    }
  }
}

/** Derive DIGITAL/PHYSICAL from type + detail coherence (single rule, shared everywhere). */
export function deriveItemCategory(productType: string, hasPhysicalDetail: boolean): 'DIGITAL' | 'PHYSICAL' {
  return productType === 'PHYSICAL_BOOK' || hasPhysicalDetail ? 'PHYSICAL' : 'DIGITAL';
}
