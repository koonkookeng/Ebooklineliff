# ADR-117: Platform Coupon & Global Campaign Manager

## Status
Accepted — Phase 117 DONE (verified 100/100 x3).

## Context
Phase 117 spec requires platform-wide campaigns, stackable coupons,
high-concurrency reservation (<50ms), and settlement-split accounting —
while 088 already owns stackable coupons (lattice math, redlock, quote
service, resolvers) on the same Coupon table, and 087 owns flash-sale
stock. The 088 lane must stay byte-identical.

## Decision
- **Extend, never fork:** CouponType/Scope unions extended; Coupon gains
  117 columns additively (campaign/seller/target/stacking/windows);
  quota/min/window readers prefer the 117 lane with 088 fallback.
  Campaign + UserCouponClaim are new (no conflicts).
- **Distinct math lanes:** 117's proportional platform allocation +
  seller/affiliate-baseline split lives in its own pure calculator (088's
  tiered lattice is different semantics); shared Zod names aliased at the
  barrel (CampaignDiscountBreakdown, couponValidateTryKey).
- **Two-phase concurrency:** Redis gives the fast path (meta cache,
  quota-mirror Lua with floor, 15-min soft holds, token-checked release,
  10/min shield); the HARD double-spend guard is the conditional DB
  increment + @@unique claim ledger. One-time claims are exact rows,
  stronger than a Bloom filter at the same latency.
- **Single stack core:** CouponStackService serves GQL + REST (no dual
  implementation); flash locks are token-owned with Lua release while
  087 keeps stock mutation.
- **Frontend dep-free:** no tanstack/lucide (plain fetch + text rows),
  5-state center, IDB coupon wallet, 4 proxies.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state UI,
  Redis locks + rate shield + atomic quota, <15MB text UI, R2 untouched,
  atomic quota/claim txns, stream telemetry, this ADR.
- Regression: 117 x3 + 088/085/109/110/111/112/113/114/115/116 green;
  backend/frontend clean; bundle guard PASS; zero new deps.
