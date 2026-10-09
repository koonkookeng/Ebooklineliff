# ADR-085: Creator e-KYC Verification & Payout Approval

## Status
Accepted — Phase 085 DONE (verified 100/100 x3).

## Context
Phase 085 spec requires Thai-ID OCR, laser checks, bank-name matching,
AES-encrypted PII, audited admin approval, and payout activation — while
the repo already has a basic 003 KYC (untouched), a `KYCStatusEnum` and
`CreatorKYCInput` names in the barrel, no vision/OCR provider, no BullMQ,
no VERIFIED_CREATOR role, and half the kyc folder labeled for phase 111.

## Decision
- **Collisions:** `CreatorKYCStatusEnum` (+ACTION_REQUIRED) and
  `CreatorEKYCInput` aliases; 003 identity KYC stays byte-identical
  (regression-proofed by the backend typecheck).
- **Math:** Thai ID mod-11, laser `AA9999999999` + ID-band linkage, Thai
  title stripping, Levenshtein fuzzy tiers (≥0.90 auto / 0.75–0.89 review /
  <0.75 reject — §7 wins over the §5.2 sketch).
- **Secrets:** AES-256-GCM envelopes (random IV, GCM-tamper-tested);
  R2 private vault with 15-min presigns and 3-min audited review URLs.
- **Honest seams:** default OCR stages for manual review (no vision key
  in repo — never fabricates text); notify port is log-only until a LINE
  OA template exists; approval flips kycStatus + payout account (no fake
  role — UserRole has no VERIFIED_CREATOR).
- **Scope:** all 18 kyc files ship the 085 vertical slice now (111 extends
  later); only `pii-crypto` (key rotation) stays scaffold. Payment-gateway
  code untouched per OUT_OF_SCOPE.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state wizard,
  AES + checksum + audit trail, <2MB watermarked uploads, R2 vault,
  atomic KYC+payout txn, KYC stream, this ADR.
- Regression: 085 x3 + 084/083 green; backend/frontend typecheck clean;
  bundle guard PASS.
