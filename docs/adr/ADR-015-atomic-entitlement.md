# ADR-015 — Atomic Slip Verification & Instant Entitlement Grant

- Status: Accepted
- Phase: PHASE-015-ATOMIC-ENTITLEMENT-GRANT
- Date: 2026-10-06

## Context
Phases 012–014 built the verify pipeline end to end. Phase 015 closes the
remaining enterprise gaps: a durability record for post-commit fan-out
(outbox), provider-outage retries, a backstop for transRef races, enriched
grant receipts, and the dropzone payment page. Several doc prescriptions are
reconciled rather than applied literally (listed below).

## Decision
- SSOT: `packages/shared/src/schemas/payment-slip.schema.ts` (§3.1: narrow
  request, nested vendor bank schemas, nested verify-result schema,
  outbox-validated atomic response, outbox/retry types). Enum single-sourcing
  kept (no duplicate enums). The live v1 API stays on the Phase-014
  superset input (URL-or-base64); GQL keeps existing field names.
- Persistence (Prisma engine only, additive): `OutboxEvent` (canonical
  schema.md shape + `orderId?` FK for cascade cleanup and one extra
  aggregate index) + `Order.outboxEvents` + `PaymentSlip.receivingBank?`.
  The doc's `pgcrypto`/`fullTextSearchPostgres`/String-status remodel is
  rejected (would regress Phases 008–014 enum work); `@@index([transRef])`
  stays covered by `@unique`.
- Provider: the legacy nested vendor path now validates through
  `EasySlipVerifyResultSchema` (the SSOT file earns its keep) before mapping
  onto the flat contract; truncated payloads keep the triple-extraction
  fallback. Rate limiting lives at the QR-issue layer (Phase-013 guard,
  5/10min) and per-order distributed locks — not inside the stateless
  provider. The doc's `redis-lock.service` is acknowledged but untouched
  (marked READ_ONLY; `setnx`-with-TTL + `finally`-release is semantically
  identical acquire/release).
- Atomicity (§5.2): the verify `$transaction` now also writes the outbox
  completion row (SlipAtomic-validated, drift-safe best-effort) and maps
  `P2002` → 409 (backstop behind the Redis `setnx` transRef claim).
  PostgreSQL `SELECT … FOR UPDATE` is deliberately skipped — the
  distributed per-order lock already serializes writers, so a raw lock
  would add latency without safety.
- Outbox (`OrderAtomicService`): `recordGrantCompleted` /
  `enqueueSlipRetry` (idempotent per order) / `dispatchPending` (oldest-
  first → `stream:outbox:<eventType>`, retry rows excluded) /
  `drainSlipRetries` (30s visibility, 3 attempts, exhaust→FAILED) /
  `startOutboxWorker` (same starter pattern as the Phase-013 sweeper;
  production cron wiring is the deploy step, like the expiry sweeper).
  Streams are namespaced so the direct `flex-receipt` emit is never doubled.
- Read side: `EntitlementService.listGrantResults` (dedupe + title fallback)
  feeds the enriched `verifyPaymentSlip` payload (`orderNumber`,
  `grantedEntitlements[]`, `processingTimeMs`) and the new
  `paymentVerificationStatus` query (poll-friendly; the doc's subscription
  is deferred — no GraphQL pubsub infra in repo).
- Client: `SlipUploadZone` (dropzone → hook pipeline → router push to
  caller-supplied URL) + LIFF `checkout/payment` page (`?orderId&tenant&
  amount`; amount is display-only, the server remains the source of truth).
  Canvas compression stays ≤300KB (stricter than the doc's 1MB; RAM <15MB);
  no lucide/framer-motion (zero-new-dep policy, inline SVG).
- GQL SDL supplements updated (`order.graphql` enrichment, new
  `payment.graphql`); code-first remains runtime truth.

## Consequences
- Trade-off: outbox fan-out is at-least-once (dispatcher marks processed
  after publish; a crash between publish and mark redelivers) — consumers
  must be idempotent (LINE send APIs dedupe by orderId client-side).
- Trade-off: retry uses DB polling, not a delayed queue — 15s worker
  granularity is fine for a ≤3-attempt safety net.
- Rollback: unregister `PaymentResolver`/`OrderAtomicService`/
  `EntitlementService`; schema additive.

## Gates (9/9)
1. SSOT sync (Prisma≡Zod≡GQL≡tests, 12 groups) 2. tsc (0 new backend
errors, frontend clean) 3. 5 zone/page states 4. setnx claim + P2002 409
+ 20-way race (1 win/19×409) 5. ≤300KB compress, bundle guard PASS
6. R2 zero-egress preserved 7. atomic txn + outbox row <1s
8. outbox/verified/retry streams 9. this ADR.
