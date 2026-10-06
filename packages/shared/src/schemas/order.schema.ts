// SSOT Phase 012 §3.1 — Order Zod domain contract (multi-tenant checkout)
// Canonical: packages/shared/src/schemas/order.schema.ts
// (legacy src/shared/schemas/order.schema.ts)
// Zero-redundant policy: OrderStatusEnum owned by ./sdid-contract.
import { z } from 'zod';
import { OrderStatusEnum } from './sdid-contract';
export { OrderStatusEnum };

export const OrderItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(99).default(1),
});
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

export const CreateOrderInputSchema = z.object({
  tenantId: z.string().uuid(),
  shippingAddressId: z.string().uuid().optional(),
  couponCode: z.string().max(64).optional(),
  items: z.array(OrderItemInputSchema).min(1, 'Order must contain at least one item').max(50),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const OrderItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  productTitle: z.string(),
  productType: z.string(),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  tenantId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  totalAmount: z.number().nonnegative(),
  shippingFee: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  netAmount: z.number().nonnegative(),
  orderStatus: OrderStatusEnum,
  paymentStatus: z.string(),
  trackingNumber: z.string().nullable(),
  orderItems: z.array(OrderItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

/** Order number: YYYYMMDD + 6 random alphanumerics (human-sortable, unique-guarded). */
export function generateOrderNumber(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');
  return `EB${ymd}${rand}`;
}
