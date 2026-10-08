# ADR-082: Automated 3% Withholding + 50 Tawi PDF Pipeline

## Status
Accepted — Phase 082 DONE (verified 100/100 x3).

## Context
Phase 082 spec requires profile-aware 3% withholding (individual/corporate/
exempt), official-shape 50 Tawi PDFs with digital seals, 15-minute download
links, monthly e-Tax export, and async issuance — without touching other
tables' migrations, without calling Revenue Dept APIs synchronously, and
without duplicating the 081 tax math (§9 single-source rule).

## Decision
- **Single math source:** `TaxCalculatorDomainService` (§6.1 verbatim
  EPSILON half-up); the 081 finance service delegates to it (refactored,
  081 tests still green). Exempt profiles resolve rate 0.
- **Ledger split:** payout-linked `WithholdingTaxRecord` (081, internal)
  vs user-facing `WithholdingTaxCertificate` (082, 50TW-YYYYMM series,
  SHA-256 seal, eTax flags). Both persist; neither double-counts money.
- **PDF:** dep-free single-page A4 compiler (core Helvetica, no react-pdf —
  Gate 5). PKCS#12 CA stamping is an honest deviation: no HSM credentials
  exist, so integrity rides the SHA-256 canonical seal + vault immutability
  + verify payload instead. Stated plainly, no crypto theater.
- **Delivery:** 15-min HMAC download tickets (ticket IS the auth, timing-safe
  verify); R2 vault stays zero-egress. LIFF previews by download, never by
  in-Webview PDF render (RAM <30MB).
- **Async shape:** TAX_WITHHELD stream handoff instead of a BullMQ package
  (zero-dep rule; 026–081 stream precedent). PDF path asserts <500ms and
  emits a slow-flag otherwise — never fails the document.
- **e-Tax:** pipe-delimited PND lines + submitted-marking behind an admin
  endpoint; Thai Tax-ID checksum gates profiles and anomaly flags.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state tax
  center, HMAC tickets + sealed PDFs, lean offline-first client, R2 vault,
  atomic certificate rows, tax streams, this ADR.
- Regression: 082 x3 + 081/080 green; backend/frontend typecheck clean;
  bundle guard PASS. `modules/payout/*` remains 086-owned.
