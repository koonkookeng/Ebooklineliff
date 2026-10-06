// SSOT Phase 008 §5.1 — Money value object (THB minor-unit arithmetic, no float drift)
// Canonical: apps/backend/src/modules/catalog/domain/value-objects/money.vo.ts
// (legacy src/backend/modules/catalog/domain/value-objects/money.vo.ts)
import { BadRequestException } from '@nestjs/common';

const SATANG_PER_BAHT = 100;

/** Parse Decimal-like (Prisma Decimal | string | number) to integer satang. */
export function toSatang(value: number | string | { toNumber(): number }): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : value.toNumber();
  if (!Number.isFinite(num) || num < 0) throw new BadRequestException('Invalid money amount');
  return Math.round(num * SATANG_PER_BAHT);
}

export function toBaht(satang: number): number {
  return satang / SATANG_PER_BAHT;
}

/** Effective sell price: discountPrice wins only when positive and below price. */
export function effectivePriceSatang(price: number | string | { toNumber(): number }, discountPrice?: number | string | null): number {
  const base = toSatang(price);
  if (discountPrice === undefined || discountPrice === null) return base;
  const disc = toSatang(discountPrice);
  return disc > 0 && disc < base ? disc : base;
}
