// SSOT Phase 117 Task 4 §5.1 — coupon domain entity (eligibility gates)
// Canonical: apps/backend/src/modules/campaign/domain/entities/coupon.entity.ts
// (legacy src/backend/modules/campaign/domain/entities/coupon.entity.ts)
// - Live window: 117 start/endDate win, fallback to 088 startAt/expireAt
//   (backfill-safe: 088 rows predate the 117 columns).
// - Quotas: 117 global/perUser lane wins, fallback to 088 total/used/perUser
//   lane. Each engine reads its own lane; shared columns stay single.
// - Targeting: targetProductType direct hit, SPECIFIC_PRODUCTS via the
//   targetProductIds set, SPECIFIC_SELLERS via sellerId.
// - Pure (no I/O). Zero new deps.
export interface CouponRow117 {
  id: string;
  code: string;
  isActive: boolean;
  startAt?: Date | string | null;
  expireAt?: Date | string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  minOrderAmount?: number | string | null;
  minPurchaseAmount?: number | string | null;
  totalQuota?: number | null;
  usedQuota?: number | null;
  globalUsageLimit?: number | null;
  currentUsageCount?: number | null;
  perUserLimit?: number | null;
  perUserUsageLimit?: number | null;
  targetProductType?: string | null;
  sellerId?: string | null;
  scope?: string | null;
  canStackWithPlatform?: boolean | null;
  canStackWithStore?: boolean | null;
  canStackWithShipping?: boolean | null;
}

export function couponWindow(row: CouponRow117): { start: Date | null; end: Date | null } {
  const startRaw = row.startDate ?? row.startAt ?? null;
  const endRaw = row.endDate ?? row.expireAt ?? null;
  return {
    start: startRaw ? new Date(startRaw) : null,
    end: endRaw ? new Date(endRaw) : null,
  };
}

export function isCouponLive(row: CouponRow117, nowMs: number): boolean {
  if (!row.isActive) return false;
  const { start, end } = couponWindow(row);
  if (start && start.getTime() > nowMs) return false;
  if (end && end.getTime() < nowMs) return false;
  return true;
}

export function quotaOf(row: CouponRow117): { limit: number; used: number; perUser: number } {
  return {
    limit: row.globalUsageLimit ?? row.totalQuota ?? 0,
    used: row.currentUsageCount ?? row.usedQuota ?? 0,
    perUser: row.perUserUsageLimit ?? row.perUserLimit ?? 1,
  };
}

export function quotaLeft(row: CouponRow117): number {
  const q = quotaOf(row);
  return Math.max(0, q.limit - q.used);
}

export function minPurchaseOf(row: CouponRow117): number {
  const v = row.minPurchaseAmount ?? row.minOrderAmount ?? 0;
  return Number(v ?? 0);
}

/** Target applicability for one cart line. */
export function lineEligible(
  row: CouponRow117,
  line: { productId: string; sellerId: string; productType: string },
  targetProductIds?: Set<string>,
): boolean {
  if (row.targetProductType && line.productType !== row.targetProductType) return false;
  if (targetProductIds && targetProductIds.size > 0 && !targetProductIds.has(line.productId)) return false;
  if (row.sellerId && line.sellerId !== row.sellerId) return false;
  return true;
}
