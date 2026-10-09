# ADR-107: PDPA Data Scope Control + Field-Level Encryption Mask

## Status
Accepted — Phase 107 DONE (verified 100/100 x3).

## Context
Phase 107 spec wants AES-256-GCM field encryption before persistence, <5ms
role-based PII masking on API responses, and a gated unmask flow with PDPA
audit — while keeping LIFF RAM <30MB, zero new deps, zero egress, and
Phase 106 (matrix engine) + Phase 129 (DSR/consent) contracts untouched.

## Decision
- **SSOT:** `pdpa-scope.schema.ts` owns `SensitiveFieldType` / `DataScopeLevel` /
  `DataScopeRole` enums + envelope/payload/unmask Zod contracts + the SINGLE
  mask source (`maskPhone/maskBankAccount/maskIdCard/maskEmail/maskAddress`,
  BDD vectors `081-***-5678` / `123-x-xxxxx-0`) + peppered `blindIndex`.
  BDD wins over §5.1's BANK regex (last-1, not last-4).
- **Crypto core:** `FieldEncryptionService` is the ONLY encryptor (§9):
  scrypt master key, 16-byte IV, hex envelopes, tamper = throw (never silent),
  `blindIndex` for exact-match search without decryption (§8.1).
- **Masking:** `PiiMaskingInterceptor` (rxjs, NestJS core dep) masks
  phone/bank/idCard/email/address + `password*`/`*token*` keys unless
  SUPER_ADMIN/COMPLIANCE_OFFICER or record owner; recurses arrays/nesting;
  skips already-masked values (idempotent chains); never logs plaintext.
- **Vault:** `UserPII` (envelopes + blind hashes) + `PIIAccessAuditLog`
  (metadata only) + `DataScopePolicy` ((tenant, role) → canUnmask/quota) are
  additive expand-contract rows; upserts run in ONE `$transaction` (Gate 7).
  No `prisma format` rewrites (exact-spacing regression guard, Phase 106 lesson).
- **Unmask:** `PiiService.requestUnmask` enforces policy row or §8.2 default
  matrix (SUPER_ADMIN/COMPLIANCE/TENANT_ADMIN/SUPPORT can; FULFILLMENT/MEMBER
  cannot except self), reason ≥5 chars, 50/day Redis INCRBY quota, DB audit
  row + `events:pii:access-audit` XADD (stream fail-open, quota fail-closed).
  Vault only stores phone/bank/idCard — EMAIL/STREET unmask is rejected.
- **API:** `PiiModule` (useFactory) + REST (`policy/vault/unmask`) +
  code-first GQL (`piiPolicy/upsertUserPii/requestUnmaskPiiField`) + SDL +
  api alias; `PiiModule` wired in `AppModule`. Phase 129 `pdpa/` module untouched.
- **Frontend:** `MaskedDataField` 5-state (INIT→IDLE→LOADING→SUCCESS+30s
  countdown→ERROR) + `usePiiUnmask` hook + `pii-client` (memory-only
  plaintext, timer-cleared) + 2 Next proxies; zero-dep, CSS `--pii-*` tokens.

## Consequences
- Plaintext PII never touches disk, logs, or audit payloads (roundtrip +
  no-leak pins in `test-phase107-contracts.ts`, 11 checks x3).
- Tradeoff: HS256-style symmetric vault (env secrets) — HSM/KMS rotation is
  the documented upgrade path; `keyVersion` envelope field reserves it.
