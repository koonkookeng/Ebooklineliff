// SSOT Phase 008 §5.1 — SKU value object (normalize + validate, zero-dep)
// Canonical: apps/backend/src/modules/catalog/domain/value-objects/sku.vo.ts
// (legacy src/backend/modules/catalog/domain/value-objects/sku.vo.ts)
import { BadRequestException } from '@nestjs/common';

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-_]{1,62}[A-Z0-9]$/;

/** Normalize seller SKUs to canonical form; throws on invalid shape. */
export function normalizeSku(raw: string): string {
  if (typeof raw !== 'string') throw new BadRequestException('Invalid SKU');
  const sku = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (sku.length < 3 || sku.length > 64 || !SKU_PATTERN.test(sku)) {
    throw new BadRequestException('Invalid SKU');
  }
  return sku;
}
