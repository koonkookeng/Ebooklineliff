# ADR-088: Stackable Coupons & Loyalty Points

## Status
Accepted — Phase 088 DONE (verified 100/100 x3).

## Context
Phase 088 spec wants layered shop + shipping + points discounts with race
safety — while its own BDD arithmetic is wrong (claims net 350, correct is
400), it names shadcn/slider/lucide (banned), BullMQ-style locks (no dep),
and a coupon universe that phase 117 will extend.

## Decision
- **Math first:** pure `stackDiscounts` is the single source (quote,
  resolver, order adapter all delegate). BDD-1 pinned at the CORRECT 400;
  the 350 erratum is documented in the contract, not silently obeyed.
- **Lattice:** 10 eligibility gates (window, min, quota, per-user, slot,
  tenant); quota consumption is Redlock-serialized with re-read — a 50-way
  race test proves exactly-one-winner and never-negative quota.
- **Seams, not duplication:** points reuse `User.rewardPoints` (083);
  order-time consume/debit are primitives the 012 flow calls (payment core
  untouched); quote degrades gracefully on poor wallets, hard gates live
  at commit time.
- **Client:** native inputs + range slider (no heavy UI libs); the drawer
  is NOT force-mounted into 012's checkout (an unapplied discount UI would
  be a lie — mount seam documented here).
- **Scope:** Prisma enums start at the 088 set; 117 union-extends.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state drawer,
  Redlock + enumeration guards, <50ms quotes, R2 banners, atomic consume
  txn, promotion stream, this ADR.
- Regression: 088 x3 + 087/086 green; backend/frontend typecheck clean;
  bundle guard PASS.
