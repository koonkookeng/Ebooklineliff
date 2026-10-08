// SSOT Phase 075 §5 — Inventory adjustment entity (no-negative invariant)
// Canonical: apps/backend/src/modules/inventory/domain/inventory-adjustment.entity.ts
// - Guards: delta application never drives stockQty below 0 (BDD-1);
//   tenant ownership on every line (BDD-1 isolation).
// - Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';

export function applyDelta(currentQty: number, delta: number): number {
  const next = currentQty + delta;
  if (next < 0) {
    throw new BadRequestException(`Stock cannot be negative. Current: ${currentQty}, Delta: ${delta}`);
  }
  return next;
}

export function assertLineTenant(headerTenantId: string | undefined, rowTenantId: string | null | undefined): void {
  const header = (headerTenantId ?? '').trim();
  if (!header) throw new ForbiddenException('Missing X-Tenant-ID header context.');
  if (rowTenantId && rowTenantId !== header) {
    throw new ForbiddenException('Cross-tenant stock access blocked.');
  }
}
