// SSOT Phase 008 §5.1/§7.1 — catalog domain events (published best-effort to `catalog-events`)
// Canonical: apps/backend/src/modules/catalog/domain/events/product-created.event.ts
export interface ProductCreatedEvent {
  event: 'product.created';
  productId: string;
  tenantId: string | null;
  productType: string;
  occurredAt: string;
}

export function productCreatedEvent(input: {
  productId: string;
  tenantId: string | null;
  productType: string;
}): ProductCreatedEvent {
  return { event: 'product.created', ...input, occurredAt: new Date().toISOString() };
}
