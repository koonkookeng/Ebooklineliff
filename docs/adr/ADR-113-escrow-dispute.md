# ADR-113: Order Escrow & Dispute Resolution

## Status
Accepted — Phase 113 DONE (verified 100/100 x3).

## Context
Phase 113 spec requires 7-day escrow holds, buyer dispute claims with R2
evidence, hybrid arbitration (atomic refund + revoke + restock), entitlement
freezes, fraud screening, and Flex alerts — while checkout (012), wallet
(017), bank settlement (086), and the entitlement gate (015/073) already
own their lanes, and Entitlement has no frozen flag.

## Decision
- **Single-writer escrow:** `holdForOrder` is idempotent (orderId @unique);
  fee defaults to 0 (081 owns splits). Hourly cron releases matured HELD
  rows per-item fail-open.
- **Atomic arbitration (Gate 7):** file and verdicts each commit in ONE
  `$transaction` — lock + claim + evidences + timelines; wallet increment /
  escrow flip / per-item revoke + restock — with measured <1s refund budget.
  Non-wallet refunds ride a timeline row + bank stream for the 086 lane.
- **Honest freeze:** file-time freeze is a logical gate (timeline +
  `entitlement.freeze.requested` stream); physical deletion happens only on
  approved refund. No Entitlement schema change.
- **Full state machine:** SUBMITTED → seller-respond → arbitration →
  APPROVED/REJECTED, plus buyer cancel (escrow resumes HELD). Resolve gates
  the 3 open states; over-claims, expired windows, and duplicates fail fast.
- **Fraud (§7):** ≥3 claims/30d trips HIGH_RISK_FRAUD stream; carrier
  webhook annotates open disputes without touching verdicts.
- **Frontend LIFF-only:** filing form (≥10 chars, ≥1 compressed evidence,
  capped amount) + escrow/timeline cards + error codes; admin arbitrates via
  dual-guarded REST/GQL (no new admin route — IN_SCOPE boundary).

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state center,
  HMAC + ownership guards + R2 vault lane, <2MB compress, zero-egress,
  atomic escrow/dispute txns, stream + Flex telemetry, this ADR.
- Regression: 113 x3 + 085/109/110/111/112 green; backend/frontend clean;
  bundle guard PASS; zero new deps.
