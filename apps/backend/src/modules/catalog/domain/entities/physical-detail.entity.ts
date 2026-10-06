// SSOT Phase 008 §5.1 — Physical detail entity (reserve/release guards; available never negative)
// Canonical: apps/backend/src/modules/catalog/domain/entities/physical-detail.entity.ts
import { BadRequestException } from '@nestjs/common';

export function availableQty(stockQty: number, reservedQty: number): number {
  return Math.max(0, stockQty - reservedQty);
}

/** Guard a reservation increment: throws when it would oversell available stock. */
export function assertReservable(stockQty: number, reservedQty: number, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new BadRequestException('Invalid reserve quantity');
  if (reservedQty + qty > stockQty) throw new BadRequestException('Insufficient stock');
}
