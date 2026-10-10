// SSOT Phase 117 §5.1 — campaign-side alias (zero-duplication re-export).
// Canonical: apps/backend/src/modules/campaign/infrastructure/redis/coupon-cache.repository.ts
// The single Redis implementation lives in modules/coupon/infra/redis
// (IN_SCOPE Task 3); this file only re-exports it for the spec tree.
export {
  CouponCacheRepository,
  QUOTA_DECREMENT_LUA,
  RESERVATION_RELEASE_LUA,
  withCouponLock,
} from '../../../coupon/infra/redis/coupon-cache.repository';
