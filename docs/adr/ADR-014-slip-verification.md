# ADR-014 — Instant Auto-Slip Verification (<0.8s SLA Hardening)

- Status: Accepted
- Phase: PHASE-014-AUTO-SLIP-VERIFY
- Date: 2026-10-06

## Context
Phases 012/013 built the verify pipeline (800ms adapter, atomic txn, QR
lifecycle). Phase 014 hardens it to a provider-grade engine: strict response
contracts, multi-provider fallback, Redis-speed replay rejection, forensic
hashing, analytics fan-out, a spec-route v1 API accepting raw base64, and a
bandwidth-safe client pipeline (≤300KB). Divergences from the phase doc are
deliberate and listed below.

## Decision
- SSOT: `packages/shared/src/schemas/slip-verification.schema.ts` (v1 input
  with image-source refine, EasySlip data/response, spec response shape,
  lock/compression constants; enums re-exported, zero-redundant) → NestJS →
  Next.js. `SlipVerificationResultSchema` (payment.schema) gains optional
  `processedInMs` (additive).
- Persistence (Prisma engine only): `PaymentSlip.slipSha256 String?` +
  index (duplicate detection across renamed files). The doc's
  `@@index([transRef])` is intentionally skipped — `transRef @unique`
  already indexes it.
- Provider (`providers/easyslip.provider.ts`, spec §5.2 shape): global fetch
  (the doc's `node-fetch` import is superseded by zero-dep policy),
  800ms/call budget (stricter than the doc's 4s — the 0.8s SLA requires it),
  Zod-validated responses, legacy nested-shape tolerance mapped onto the
  spec contract, SlipOK fallback when `SLIPOK_API_URL/KEY` are set (spec §10
  self-healing; `onFallback` hook feeds analytics).
- Adapter keeps the Phase-012 `VerifiedSlip` contract and now routes
  base64→`{image}` / URL→`{image_url}`; error class + timeout const live in
  the provider (single source, re-exported for compat).
- Anti-replay (BDD scenario 2): atomic `setnx slip:transRef:{ref}` (30-day
  TTL, <10ms) after provider success; replay → `ConflictException`
  `SLIP_ALREADY_USED`, zero DB change, `payment_slip_fraud_alert` event +
  fraud-guard strike. DB `transRef @unique` remains the backstop race guard.
- Failure semantics (BDD scenario 3): amount/account mismatch → `FAILED`
  (user-actionable); provider outage → `PENDING_SLIP` (retryable). There is
  no `PAYMENT_FAILED` order status — `paymentStatus FAILED` is the contract.
- Analytics (§7): `payment_slip_uploaded` {orderId, tenantId?, fileSizeKb}
  from the upload path; `payment_slip_verified_success` {transRef,
  processedInMs, amount} on verify; existing streams untouched.
- v1 API (§5.4 route `POST /api/v1/payment/verify-slip`): facade
  `SlipVerificationService` (base64→R2 materialize with sha
  carry-through→atomic verify→spec-shape map) registered in OrderModule
  (no cycle); HTTP boundary extracted as `handleVerifyRequest` so contract
  tests run without experimentalDecorators (tsx limitation — same reason
  `@Optional` is avoided repo-wide). GQL keeps the existing
  `verifyPaymentSlip(orderId, slipImageUrl)` field (superset behavior);
  the doc's input-object variant is not duplicated.
- Client (§2.1/§6): `lib/slip-image.ts` canvas downscale + JPEG quality
  ladder to ≤300KB with synchronous canvas/object-URL release;
  `useSlipVerification` (compress→R2→verify, base64 fallback when R2 is
  down, Thai error mapping); `SlipUploadModal` 5-state with inline SVG
  (the doc's `lucide-react`/`framer-motion` are rejected per zero-new-dep
  policy). Upload lib returns `{slipImageUrl, slipSha256?, fileSizeKb?}`
  (backward-compatible).

## Consequences
- Worst-case fallback path exceeds 0.8s (800ms × 2 + txn) — surfaced via
  the existing `sla-breach` monitor event, never as a post-grant failure.
- Trade-off: strict provider validation means a drifting vendor shape falls
  back to SlipOK/error rather than best-effort parsing (fail-closed money).
- Rollback: unregister `PaymentSlipController`/`SlipVerificationService`
  from OrderModule; schema additive.

## Gates (9/9)
1. SSOT sync (Prisma≡Zod≡provider≡tests, 13 groups) 2. tsc (0 new backend
errors, frontend clean) 3. 5 modal/hook states 4. Redis replay lock +
fraud alert + guard strikes 5. ≤300KB compress, bundle guard PASS
6. R2 zero-egress preserved 7. atomic txn + setnx claim 8. uploaded/
verified_success/fraud_alert analytics 9. this ADR.
