# ADR-081: Real-Time Double-Entry Ledger + Commission Settlement

## Status
Accepted — Phase 081 DONE (verified 100/100 x3).

## Context
Phase 081 spec requires an enterprise double-entry ledger (BDD-1: 1000 →
fee 50 / t1 100 / t2 20 / seller 830), locked payouts with 3% e-withholding
(BDD-2: 5000 → tax 150 / net 4850), live wallet push (<300ms), and daily
reconciliation — without touching the slip verifier or entitlement schema,
and without duplicating the 026/079 attribution or the 086 payout worker.

## Decision
- **Ledger:** `FinancialAccount` (one row per user, NULL-userId platform
  accounts) + append-only `LedgerJournal`/`LedgerEntry` (no update/delete
  paths by construction). Cents-integer splits; seller takes the remainder
  so Σdebits == Σcredits holds by construction, asserted pre-persist.
- **Rules:** `CommissionRule` card (per-product else global else 5/10/2).
  The 079 `AffiliateTierConfig` cards keep serving the affiliate engine;
  finance reads only its own cards (zero cross-writes).
- **Payout:** `PayoutTransaction` expanded additively (073 columns kept;
  `merchantProfileId` relaxed to optional, 081 bank/tax/status columns
  defaulted) + `WithholdingTaxRecord` with dep-free %PDF certs in R2.
  Redis `SET NX EX` mutex is fail-closed; approval is admin-only and only
  flips REQUESTED → PROCESSING_BANK (086 owns bank settlement).
- **Realtime:** Redis balance cache (300s) + wallet stream + pub/sub on
  every posting; SSE endpoint snapshots + 5s cadence, 15s polling fallback
  in the hook. No socket.io (zero-dep LIFF rule).
- **GQL names:** `Finance*`-prefixed payloads — `PayoutResponsePayload` is
  079-owned. `modules/payout/*` scaffolds stay 086-owned (asserted in tests).
- **Reconcile:** `GET admin/reconcile` probe (Δ + payoutsPaused flag) is
  cron-ready; no scheduler dep added.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state wallet,
  locked payouts + append-only books, lean SSE client, R2 tax PDFs, atomic
  journals, wallet/journal/payout streams, this ADR.
- Regression: 081 x3 + 080/079 green; backend/frontend typecheck clean;
  bundle guard PASS. Escrow balances report 0 until the escrow phase lands.
