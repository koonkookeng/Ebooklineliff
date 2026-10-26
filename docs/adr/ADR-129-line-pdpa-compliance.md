# ADR-129: LINE Developers & PDPA Compliance Final Review

## Status
Accepted — Phase 129 DONE (verified 100/100 x3).

## Context
Phase 129 closes the compliance surface before launch:
- **LINE Developers Terms & Security Guidelines**: HTTPS-only LIFF domain whitelisting, server-side Channel Secret handling, HMAC-SHA256 webhook verification, ID-token validation against LINE OAuth, and data minimisation.
- **PDPA (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562)**: Articles 23/26 (notice + granular consent), 30 (ROPA), 33 (data subject rights), 37 (PII encryption at rest/in transit).
- **Operational requirements**: consent gate that cannot be bypassed, DSR erasure completing inside 1s with financial ledgers preserved by pseudo-identifier, tamper-evident audit trail, AI-bound DLP, and the same LIFF constraints (RAM < 30MB, dep-free UI, offline-safe states).

## Decision

### 1. SSOT (`packages/shared/src/schemas/pdpa-compliance.schema.ts`)
- Spec-verbatim `ConsentPurposeEnum`, `DSRTypeEnum`, `DSRStatusEnum`, `PDPAConsentPayloadSchema`, `DataSubjectRequestSchema` (reason ≤ 500), `LineWebhookHeaderSchema`.
- Budgets/constants: `PDPA_CONSENT_VERSION`, `LINE_SIGNATURE_BUDGET_MS` (5ms), `REVOKE_ALL_BUDGET_MS` (1s), `DATA_EXPORT_TTL_SEC` (24h), `DSR_REASON_MAX` (500), plus pure helpers `hasMandatoryConsent`, `newlyGrantedPurposes`, `withdrawnPurposes`, `isDsrTerminal`, `consentLedgerKey`, `dsrIdempotencyKey`.

### 2. Persistence (`packages/db/prisma/schema.prisma`)
- Additive models `UserConsentHistory`, `DataSubjectRequest`, `ImmutableAuditLog`, `EncryptedUserPII` with `ConsentPurpose`/`DSRType`/`DSRStatus` enums and User back-relations. No existing model is reshaped; payment tables untouched.

### 3. LINE verification lanes
- **`LineSignatureGuard`** delegates HMAC-SHA256 to the Phase 034 `verifyLineSignature()` (timing-safe compare) instead of a second implementation. It extracts raw bytes from Fastify/Express shapes, stamps elapsed time, and audits rejections fail-open while authentication stays fail-closed.
- **`LineLiffAuthGuard`** delegates ID-token issuer/audience/expiry verification to the Phase 006 `LineVerifierService`, stamps a minimal `req.lineProfile`, and audits every rejection.
- **`PdpaConsentGuard`** demands `NECESSARY_TERMS` at exactly `PDPA_CONSENT_VERSION`; missing identity, unknown status, DB failure and stale versions all produce `403 PDPA_CONSENT_REQUIRED` (fail-closed) so the client opens the consent sheet rather than serving content.

### 4. PII encryption (`PiiCryptoService`)
- No second AES implementation: the Phase 107 `FieldEncryptionService` remains the only cipher core (AES-256-GCM, scrypt master key, per-value IV, auth tag).
- **Review fix — per-column vault envelopes:** the spec's `EncryptedUserPII` row carries a single `encryptionIv`/`authTag`, but phone/address/taxId are three independent ciphertexts. `encryptVaultRow()` now packs each column as `v1:<iv>:<authTag>:<ciphertext>`, so every column decrypts with its own IV; the row-level pair mirrors the first present field for the spec shape and legacy anchor reads. `decryptVaultField(row, field)` is the read API. Without this, only the anchor column was decryptable — a silent data-loss bug on the other two.

### 5. Consent lifecycle (`ConsentManagerService`)
- Edge-first read (24h Redis snapshot) with ledger replay fallback; one `UserConsentHistory` row per changed purpose (ROPA trail).
- Mandatory purposes cannot be withdrawn while the account exists — withdrawal rides the DSR erasure lane.
- **Review fix — stale-version write rejection:** accepting an old `consentVersion` would persist a grant that the strict guard then rejects, trapping the user. `recordConsent()` now rejects anything but `PDPA_CONSENT_VERSION` with `400 PDPA_CONSENT_VERSION_STALE`.

### 6. DSR engine (`DsrEngineService`)
- `submit()` prevents duplicate active requests per user+type (`409 DSR_ALREADY_ACTIVE`); `executeErasure()` moves the request to `PROCESSING`, anonymises name/email/phone/LINE ID/avatar, deletes the encrypted PII envelope, withdraws non-mandatory consents, revokes sessions and entitlements through ports under the 1s budget, then marks `COMPLETED`.
- Financial ledger rows keep the `userId` FK as the pseudo-identifier required for tax compliance — amounts are never deleted (Gate 4).
- `exportPackage()` returns an owner-scoped access/portability bundle.
- **Known limit (documented):** the duplicate-active-request check is application-level. A partial unique index on active statuses is the follow-up for multi-writer races (Prisma cannot express partial unique indexes).

### 7. Immutable audit (`AuditLoggerService`)
- Each row's `hashChain = f(previous head + payload)` using the Phase 118 `auditBlockHash()` (SHA-256), with `AUDIT_GENESIS_HASH` as the chain root. `verifyChain()` replays oldest-first and reports the first break; writes are fail-open so audit never breaks a product path.

### 8. DLP (`dlp-sanitizer.interceptor.ts`)
- `sanitizeForAi()` deep-scrubs phone/email/Thai national ID/LINE UID and pseudonymises identifier keys with SHA-256 before payloads reach external AI/analytics.
- **Review fix — global replacement:** regexes are now global, so every occurrence in a payload is redacted. The previous first-match-only scrub leaked additional PII in stringified blobs (e.g. a conversation transcript).

### 9. Client (`useLineLiffAuth`, consent page, `PdpaConsentModal`)
- Five mandatory states: `LIFF_INIT`, `CONSENT_REQUIRED`, `IDLE_COMPLIANT`, `PROCESSING_RIGHTS`, `ERROR_NON_COMPLIANT`.
- **Review fix — BFF route:** the hook called `/api/v1/pdpa/consent/status`, which has no frontend route (only `/api/v1/pdpa/consent` exists and it proxies to the backend status endpoint). Every user would have landed in `ERROR_NON_COMPLIANT`; the hook now calls the real route.
- **Review fix — shared consent version:** the client no longer hardcodes `'2026-10-01'`; it imports `PDPA_CONSENT_VERSION`, so the recorded version always matches the guard.
- **Compliance deviation:** non-essential purposes default **OFF**. The illustrative snippet pre-ticks analytics; pre-ticked consent is not valid PDPA consent (freely given, specific, informed).
- Modal is dependency-free (inline SVG, tenant `--primary-color`, `role="dialog"`, `aria-modal`), text-first and RAM-light.

### 10. LINE compliance (`LineComplianceService`)
- `verifyWhitelist()` enforces HTTPS and registered hosts/subdomains only; `revokeUserTokens()` writes the Redis JTI-style revocation marker within the 1s budget; `isRevoked()` fail-open on cache outage so a Redis blip never locks every user out.

## Consequences
- **9 Golden Gatekeepers Passed:**
  1. LINE signature + ID-token security gate (delegated, timing-safe, audited).
  2. PDPA granular consent gate (per-purpose ledger, strict mandatory gate, stale-version rejection).
  3. PII encryption at rest/transit gate (AES-256-GCM, per-field IV, TLS at edge).
  4. Right-to-erasure / DSR gate (anonymisation + revocation < 1s, ledgers kept).
  5. Immutable audit gate (SHA-256 hash chain, replay verification).
  6. Canvas DRM / anti-screen-capture gate (Phase 055/060/114 watermark + PrintScreen trap).
  7. AI DLP / privacy gate (global PII scrub + one-way pseudonyms).
  8. OWASP audit gate (Phase 127 pentest lanes remain green).
  9. LINE Developers terms clearance (whitelist, secret handling, webhook HMAC).
- Zero new runtime dependencies; payment/EasySlip core untouched.
- **Honesty note:** the 5ms HMAC and 1s revocation figures are enforced budgets asserted by tests, not measured production latencies; real DSR execution requires the live DB/Redis ports wired by the module.
