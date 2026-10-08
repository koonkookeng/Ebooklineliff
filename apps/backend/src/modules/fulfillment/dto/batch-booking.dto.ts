// SSOT Phase 076 §5.1 — Batch booking DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/fulfillment/dto/batch-booking.dto.ts
// - Thin transport type; validation lives in fulfillment-contract.ts (SSOT).
// - Zero new deps.
export interface BatchBookingDto {
  orderIds: string[];
  courierProvider: string;
  warehouseId: string;
}
