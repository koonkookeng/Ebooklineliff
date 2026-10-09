// SSOT Phase 084 §5.1 — Abandoned cart DTOs (thin transport; Zod owns validation)
// Canonical: apps/backend/src/modules/messaging/dto/abandoned-cart.dto.ts
// - Zero new deps.
export interface MarkAbandonedDto {
  cartId: string;
}

export interface RecoverCartDto {
  recoveryToken: string;
}
