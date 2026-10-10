# ADR-111: Creator KYC Identity Verification Queue Engine

## Status
Accepted — Phase 111 DONE (verified 100/100 x3).

## Context
Phase 111 spec requires a Creator e-KYC verification queue: OCR identity
extraction, fraud risk scoring, PDPA private vault, admin review workspace,
atomic SELLER unlock, and LINE Flex verdict notifications — while the repo
already ships a complete 085 e-KYC vertical (submission tiers, AES-GCM
engine, staged OCR, stream queue, log-only notify, 3-step wizard, admin
console, presigned vault). No SellerStore table exists; no BullMQ, vision,
or LINE-push deps are allowed (zero-dep rule).

## Decision
- **Additive-only over 085:** 085 submission/decide lanes, wizard, vault
  (180s), and contracts stay byte-identical (085/109/110 regressions green;
  one stale 085 placeholder guard updated to assert the 111 implementation).
- **Zod SSOT:** new `kyc-queue.schema.ts` (submission/review/OCR-risk +
  §7.1 percent tiers + 300s/500ms/20-page budgets); checksum/fuzzy helpers
  imported from `kyc-contract.ts`, never duplicated.
- **Prisma:** `KYCRiskLevel` enum + `riskLevel`/`isPossibleTamper`/
  `idCardBlindIdx` + `createdAt`/`idCardBlindIdx` indexes (random-IV
  ciphertext cannot be compared — the SHA-256 blind index can).
- **Risk:** `KycRiskService` (§7.1 ≥95 LOW / 80–94 MEDIUM / <80 HIGH,
  duplicate→CRITICAL; <50% confidence→HIGH manual review, best-effort,
  never blocks submit).
- **Verdicts:** `KycQueueReviewService` — ONE `$transaction`: KYC +
  `User.kycStatus` + MEMBER-only SELLER promotion + payout ACTIVE/SUSPENDED
  + audit (Gate 7) → `kyc.approved` stream (storefront provisioning rides
  the event: no store table in schema.md) → Flex notify fail-open with
  `verdictNotifyMs` telemetry. `PiiCryptoService` is a zero-duplication
  facade (masks `1-1004-XXXXX-12-1` / `XXX-X-X1234-X`); Flex bubbles pure
  with <10KB guard; R2 `docViewUrl` 300s; HMAC-guarded OCR webhook.
- **Frontend:** spec-verbatim `processKycDocumentImage` (1920×1080, WebP
  0.85, revoke discipline, Gate 5) + admin split-view workspace (F8/F9,
  risk badges, mismatch highlights, context-menu block) + 5-state queue
  page + 2 Next proxies. 085 LIFF wizard untouched.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync (Prisma/Zod/GQL/SDL), zero type
  errors (backend+frontend), 5-state queue workspace, AES-GCM + blind
  index + masked PII + private R2, <30MB WebP pipeline, zero-egress 300s
  URLs, atomic approve→SELLER txn, audit + Flex + stream telemetry, this ADR.
- Regression: 111 x3 + 085/109/110 green; backend/frontend typecheck clean;
  bundle guard PASS; zero new deps.
