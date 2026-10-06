# ADR-013 — Dynamic PromptPay QR Engine (Fractional Cent + TTL Expiry)

- Status: Accepted
- Phase: PHASE-013-PROMPTPAY-QR-EXPIRY
- Date: 2026-10-06

## Context
Phase 012 mints one static QR payload per order (exact net amount, no expiry
lifecycle). Concurrent pending orders for the same amount collide on
statement matching, and unpaid QRs never release. The spec asks for
server-rendered QR Base64 via the `qrcode` npm lib plus Redis keyspace
expiry; both conflict with repo policy (zero new deps, deterministic
behavior on any cluster config).

## Decision
- SSOT: `packages/shared/src/schemas/promptpay.schema.ts` (status/input/
  payload/expiry + rate/fraud constants) → SDL supplement
  (`api/graphql/schemas/promptpay.graphql/schema.graphql`) → NestJS
  (`PromptPayModule`) → Next.js (`lib/checkout.ts` + widget + proxies).
  `OrderStatusEnum` (sdid-contract) gains additive `EXPIRED`.
- Persistence (Prisma engine only, additive): `PromptPayStatus` enum +
  `PromptPayTransaction` (canonical schema.md shape: 1:1 order, base/cent/
  total, ref1/ref2, expiresAt, `@@index([expiresAt])`,
  `@@index([totalAmount, status])`) + `Order.promptPayTransaction?`.
- EMVCo: payload/CRC reuse the Phase-012 builder (single source); the spec's
  `calculateCRC16` nibble algorithm lives in `utils/emvco-crc16.util.ts` and
  contract tests assert byte-equality with canonical `crc16`.
- No `qrcode` npm dep: QR pixels render client-side via installed
  `react-qr-code` (zero-egress, zero new deps, <30MB); `qrCodeBase64` stays
  an optional future server-render slot in Zod/GQL (sync, unused today).
- Fractional cent: 0.01–0.99 random allocation guarded by a live
  `findFirst(totalAmount, PENDING, expiresAt>now)` (≤50 tries, 0.00 fallback
  + `fractional-collision` event). Regenerate from EXPIRED resets the order
  to PENDING_PAYMENT/UNPAID in the same upsert transaction.
- Expiry: sweeper over indexed `expiresAt` + lazy flip on status reads
  (deterministic everywhere; `handleTtlKey` reserved if infra ever enables
  keyspace notifications). Expiry flips txn→EXPIRED (slot release) +
  order→EXPIRED, emits `qr-expired` analytics + `notify:order-expired`
  (LINE Flex consumer contract). VERIFIED/COMPLETED money never transitions.
- Slip-verify (surgical, backward-compatible): expected amount =
  max(net, live QR total); txn also flips QR→PAID; failures feed the fraud
  guard; EXPIRED orders rejected until regenerate. Guard param is DI-optional
  (no `@Optional` decorator — tsx contract tests run without
  experimentalDecorators; OrderModule→PromptPayModule wiring resolves it).
- Abuse: 5 QR/10min per user (429) + 3 slip-failure strikes → 15-min QR
  freeze (403), cleared on verified payment. Counter state in get/setex/del
  only (cluster-safe, no Lua/incr; uses `{userId}` hash tags).
- Frontend: `PromptPayQRWidget` (local QR, fractional highlight, copy
  amount/ref, 1s countdown, 20s status poll, slip upload reuse, 5 states
  incl. EXPIRED+regenerate, tenant accent/logo props → `--primary-color`);
  LIFF/Web `/checkout` SUCCESS renders the widget (fractional totals must be
  displayed for exact-amount transfer). Phase-012 modal kept (unchanged).
- Generate path <100ms with fakes (self-heal budget per spec §10).

## Consequences
- Trade-off: same-order re-issue overwrites the single txn row (1:1) — by
  design (one live amount per order); cross-order uniqueness holds.
- Trade-off: sweeper granularity (~60s) instead of instant keyspace TTL —
  lazy status reads cover UX immediacy.
- Rollback: remove `PromptPayModule` from App/OrderModule; schema additive.

## Gates (9/9)
1. SSOT sync (Prisma≡Zod≡GQL≡tests, 16 groups) 2. tsc (0 new backend
errors post-generate, frontend clean) 3. 5 widget states incl. EXPIRED
4. rate-limit + fraud freeze + transRef replay 5. local QR, bundle guard
PASS 6. zero-egress (no QR image storage) 7. atomic upsert/expiry/verify
txns 8. qr-generated/expired/collision + flex-receipt events 9. this ADR.
