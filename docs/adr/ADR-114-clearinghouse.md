# ADR-114: Global Financial Clearinghouse

## Status
Accepted — Phase 114 DONE (verified 100/100 x3).

## Context
Phase 114 spec requires settlement double-entry, 70/10/20 splits, 3% tax
payouts with 50-Tawi PDFs, bank dispatch, and statement reconciliation —
while 081 (journals), 082 (tax math + PDF vault), 086 (KYC-gated clearing +
bank adapters), 091 (vectors), 113 (escrow holds), and 115 (statement
matching, future) already own their lanes, and Entitlement/Order cores are
read-only context.

## Decision
- **Reuse, never recompile:** 3% math delegates to 082 (single source);
  bank dispatch + cert PDFs ride staged streams to the 086/082 lanes;
  statement ingestion detail stays in 115; fee splits stay in 081.
  114 owns only settlement rows, settled-balance payouts, and verdicts.
- **Gate 5 honesty:** spec §5.2's 5-row batch cannot balance (1000 ≠ 2000)
  — the engine posts the ESCROW clearing debit (6 rows) and fail-closed
  guards every batch. Spec §5.1 credits the buyer; the engine credits the
  113 escrow seller (fallback: first item's product seller).
- **Money safety:** cents-exact splits (remainder → platform), per-seller
  Redis mutex against double-spend (contention → retryable, outage →
  fail-open), over-balance/over-100% fail-fast, unique transRef + reference
  codes, idempotent re-settlement.
- **Discrepancy > 0.01 THB** flags the order + freezes the seller's payouts
  (24h Redis, fail-open probes) with incident streams; seller attribution
  via 113 escrow.
- **Frontend dep-free:** no shadcn/recharts (CSS only), 2-decimal THB,
  per-amount audit trace modal, 5-state machines on both consoles.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync (Prisma union/Zod-alias/GQL),
  zero type errors, 5-state consoles, KYC/bank/freeze guards + HMAC-grade
  stream isolation, text-only RAM profile, zero-egress (no new binary
  lanes), atomic settlement/payout txns, stream + Flex telemetry, this ADR.
- Regression: 114 x3 + 085/109/110/111/112/113 green; backend/frontend
  clean; bundle guard PASS; zero new deps.
