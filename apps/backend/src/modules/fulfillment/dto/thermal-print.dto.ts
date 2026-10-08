// SSOT Phase 076 §5.1 — Thermal print DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/fulfillment/dto/thermal-print.dto.ts
// - Thin transport type; validation lives in fulfillment-contract.ts (SSOT).
// - Zero new deps.
export interface ThermalPrintDto {
  orderIds: string[];
  courierProvider: string;
  labelDpi?: string;
  autoUpdateStatusToPrinted?: boolean;
}
