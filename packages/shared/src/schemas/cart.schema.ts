// SSOT Phase 011 §3.1 — Smart hybrid cart Zod domain contract (digital/physical split)
// Canonical: packages/shared/src/schemas/cart.schema.ts
// (legacy src/shared/schemas/* cart contract)
// Zero-redundant policy: ProductTypeEnum owned by ./sdid-contract.
import { z } from 'zod';
import { ProductTypeEnum } from './sdid-contract';

export const CartItemTypeEnum = z.enum(['DIGITAL', 'PHYSICAL']);
export type CartItemType = z.infer<typeof CartItemTypeEnum>;

export const CarrierEnum = z.enum(['FLASH', 'KERRY', 'THAIPOST']);
export type Carrier = z.infer<typeof CarrierEnum>;

export const SmartCartItemSchema = z.object({
  cartItemId: z.string().uuid(),
  productId: z.string().uuid(),
  title: z.string(),
  coverImageUrl: z.string().url(),
  productType: ProductTypeEnum,
  itemCategory: CartItemTypeEnum,
  unitPrice: z.number().positive(),
  quantity: z.number().int().min(1).max(99),
  weightGrams: z.number().int().nonnegative().default(0),
  sku: z.string().optional(),
});
export type SmartCartItem = z.infer<typeof SmartCartItemSchema>;

export const HybridCartSplitSummarySchema = z.object({
  digitalItems: z.array(SmartCartItemSchema),
  physicalItems: z.array(SmartCartItemSchema),
  digitalSubtotal: z.number().nonnegative(),
  physicalSubtotal: z.number().nonnegative(),
  totalPhysicalWeightGrams: z.number().int().nonnegative(),
  estimatedShippingFee: z.number().nonnegative(),
  appliedDiscountAmount: z.number().nonnegative(),
  grandTotalAmount: z.number().nonnegative(),
  requiresShippingAddress: z.boolean(),
});
export type HybridCartSplitSummary = z.infer<typeof HybridCartSplitSummarySchema>;

export const CalculateShippingInputSchema = z.object({
  cartId: z.string().uuid(),
  shippingAddressId: z.string().uuid(),
  preferredCarrier: CarrierEnum.optional(),
});
export type CalculateShippingInput = z.infer<typeof CalculateShippingInputSchema>;

export const AddToCartInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1),
});
export type AddToCartInput = z.infer<typeof AddToCartInputSchema>;

export const UpdateCartItemQuantityInputSchema = z.object({
  cartItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});
export type UpdateCartItemQuantityInput = z.infer<typeof UpdateCartItemQuantityInputSchema>;

/** Physical iff PHYSICAL_BOOK type or a physical detail row exists (bundle/physical). */
export function isPhysicalProduct(productType: string, hasPhysicalDetail: boolean): boolean {
  return productType === 'PHYSICAL_BOOK' || hasPhysicalDetail;
}

/** Effective unit price: valid discount wins, otherwise list price (satang-safe). */
export function effectiveUnitPrice(price: number, discountPrice: number | null): number {
  if (discountPrice !== null && discountPrice > 0 && discountPrice < price) return discountPrice;
  return price;
}
