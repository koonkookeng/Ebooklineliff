# ADR-086: Payout Clearing & Bank Transfer Settlement

## Status
Accepted — Phase 086 DONE (verified 100/100 x3).

## Context
Phase 086 spec asks for a parallel payout universe (new status enum,
PayoutRequest + WalletLedger tables, fresh tax math, live bank HTTP).
The repo already settles money in 081 (ledger + locked payouts), issues
50TW PDFs in 082, gates KYC in 085, and owns aff-/merchant payout names.
A third system would triple-count money.

## Decision
- **One record:** `PayoutTransaction` stays canonical (no PayoutRequest
  table). `REQUESTED ≡ PENDING_APPROVAL` at creation; union gains only
  `PENDING_APPROVAL` + `FAILED_BANK_TRANSFER` (+`payoutNo` column, fixing
  an 081 latent write-without-column, and `transRef` replay key).
- **One math:** calculator/tax/PDF all delegate (081 §8.2, 082 pipeline).
- **One ledger:** 081 `LedgerEntry` remains the book; the existing 017
  `WalletLedger` is extended additively (nullable user trail columns) for
  the hold/deduct/refund audit — no second table.
- **Honest transport:** bank adapters STAGE HMAC-signed batches; SUCCESS
  happens only via the HMAC-verified bank callback (replay-guarded,
  failure releases the hold). Nothing fabricates transfers.
- **Gates:** e-KYC VERIFIED + ACTIVE payout account (085, decrypted inside
  the transport boundary), Redis mutex + row-level atomicity, admin-only
  batch/clearing paths, receipt event seam for the Flex worker.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state studio,
  KYC + mutex + HMAC + RBAC, lean client, R2 PDFs, atomic settlement txn,
  clearing stream, this ADR.
- Regression: 086 x3 + 085/084 green; backend/frontend typecheck clean;
  bundle guard PASS.
