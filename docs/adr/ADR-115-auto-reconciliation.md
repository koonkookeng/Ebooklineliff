# ADR-115: Bank Statement Auto-Reconciliation & Manual Override

## Status
Accepted — Phase 115 DONE (verified 100/100 x3).

## Context
Phase 115 spec requires bank-statement ingestion with SHA-256 dedupe,
multi-strategy auto-matching (<500ms), atomic order completion +
entitlement grants, maker-checker overrides above ฿1,000, hash-chained
audit trails, fraud screening, and a data-dense dashboard — while slip
verification (014/015), entitlement grants (015), payout clearing (086),
and settlement flagging (114) already own adjacent lanes.

## Decision
- **No duplicate lanes:** 115 persists statements/logs/overrides (new
  tables) and reads slips/orders; it never recompiles slip verification,
  wallet payouts, or 114 verdicts. Entitlement writes go straight through
  Prisma inside 115's own transactions (module files untouched).
- **Explicit verdicts:** exact-ref (100), unique window (95), ambiguity
  (50/DISCREPANCY), miss (REF_NOT_FOUND), duplicate hash
  (REJECTED_DUPLICATE), fraud screen (SUSPICIOUS → manual lane). Amounts
  compare cents-exact; windows honor per-account tolerance (default 30m).
- **Dual control:** ≤1000 single-control immediate apply; >1000 PENDING +
  provisional chain hash, checker ≠ maker, designated pin enforced.
  previousStatus is captured pre-flip (never read back post-update).
- **Chain honesty:** H(prev|stmt|order|maker|ts) with row createdAt pinned
  to ts so verifyChain replays exactly; head in Redis (fail-open GENESIS);
  mint-after-commit (human-paced lane; concurrent-mint fork documented).
- **Frontend dep-free:** no shadcn/lucide/recharts (CSS only), split-pane
  queue, modal with ≥10-char gate, 5-state machine, 5 proxies.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state
  dashboard, HMAC + finance guards + dual control, CSS-only lists, R2
  untouched (no new binary lanes), atomic match/override txns, stream +
  Flex telemetry, this ADR.
- Regression: 115 x3 + 085/109/110/111/112/113/114 green; backend/frontend
  clean; bundle guard PASS; zero new deps.
