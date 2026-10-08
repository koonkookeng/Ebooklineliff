# ADR-079: Multi-Tier Social Affiliate Engine (10/3/1 + 3% e-Withholding)

## Status
Accepted — Phase 079 DONE (verified 100/100 x3).

## Context
Phase 079 spec (§8.1/Gate 9) requires a multi-tier referral payout ledger with
automatic 3% e-Withholding tax on affiliate cash-outs, plus anti-self-referral
fraud screening and LINE Flex viral sharing. Money movement must stay inside
one atomic Prisma transaction (<500ms, BDD-2); fraud hits must block payout
while the order still processes normally (BDD-3).

## Decision
- **Rates:** global default 10% / 3% / 1% (`AffiliateTierConfig`, NULL productId =
  global; per-product override via unique productId). Bank-rounded to 2 decimals
  (`tierCommission`).
- **Ledger:** immutable `CommissionLog` rows per tier (APPROVED | BLOCKED_FRAUD
  + fraudReason) + `User.walletBalance` increments in the same `$transaction`.
  Idempotency via `hasCommissionForOrder` (ALREADY_DISTRIBUTED); ancestor walk
  capped at 3 hops with seen-set cut (circular loops can never infinite-loop).
- **Fraud screen order:** same-user → same LINE ID → device-fingerprint reuse →
  velocity (>5 paid orders / fingerprint / 10 min). Hits emit to
  `affiliate:fraud:events` Redis stream and persist BLOCKED_FRAUD rows.
- **Payout:** 100 THB floor; approved-earnings cover check; 3% split
  (`payoutSplit`: tax = round(3%), net = amount − tax) persisted as
  `AffiliatePayout` REQUESTED with unique `payoutNo` (P2002-safe retry).
  PDF/XML filing against the Revenue Department stays out of scope (finance
  module consumes the split columns).
- **Viral share:** server-built LINE Flex bubble (hero cover + price + signed
  referral CTA); LIFF client uses `window.liff.shareTargetPicker` when present,
  clipboard fallback otherwise — no `@line/liff` dep (RAM <30MB, Gate 5).
  `ShareEvent.refToken` carries a timestamp suffix so repeat shares never
  collide on the unique constraint.
- **Deviations (RISK_CALL, additive-only):** `tenantId` required on Zod inputs
  (x-tenant-identifier vocabulary, Phase 071/073); no `@line/liff` dep (§6.1
  asks it) — documented in `affiliate-contract.ts`.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state LIFF hub,
  fraud screen, <30MB lean client, R2 zero-egress covers, atomic ledger,
  Redis commission/fraud streams, this ADR.
- Regression: Phase 078 + 077 contract suites green; backend/frontend
  typecheck clean; bundle guard PASS.
