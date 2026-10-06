// SSOT Phase 008 §5.1/§7.1 — stock reservation event (drives low-stock alerts downstream)
// Canonical: apps/backend/src/modules/catalog/domain/events/stock-reserved.event.ts
export interface StockReservedEvent {
  event: 'stock.reserved';
  productId: string;
  qty: number;
  availableAfter: number;
  occurredAt: string;
}

export function stockReservedEvent(input: {
  productId: string;
  qty: number;
  availableAfter: number;
}): StockReservedEvent {
  return { event: 'stock.reserved', ...input, occurredAt: new Date().toISOString() };
}
