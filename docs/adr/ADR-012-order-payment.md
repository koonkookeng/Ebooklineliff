# ADR-012 — Atomic Order + Instant Slip Verification + Entitlement Unlock

- Status: Accepted
- Phase: PHASE-012-ORDER-PAYMENT-ENTITLEMENT
- Date: 2026-10-06

## Context
Checkout converts a hybrid cart (Phase 011) into a payable order with a
time-bound (15-min) dynamic PromptPay QR; slip upload must verify via EasySlip
and unlock content entitlements atomically in <1s. LIFF payment UI must stay
<20MB of the 30MB webview budget; a Phase-004 `OrderPaymentResolver` already
owns the legacy `createOrder(productIds)` mutation in the Apollo gateway.

## Decision
- SSOT: `packages/shared/src/schemas/{order,payment,entitlement}.schema.ts`
  (`OrderStatusEnum`/`ContentAccessTypeEnum` re-exported from `sdid-contract`,
  zero-redundant) → SDL (`api/graphql/schemas/order.graphql/schema.graphql`)
  → NestJS (`OrderModule`) → Next.js (`lib/checkout.ts` + LIFF/Web pages).
- Persistence (expand-contract, additive only): `Order` gains `tenantId?`,
  `totalAmount`/`shippingFee`/`discountAmount`, `PaymentStatus` enum
  (`UNPAID` default), `trackingNumber`, composite `@@index([orderStatus,
  paymentStatus])`; `OrderItem` gains `@@index([orderId/productId])`;
  `PaymentSlip` gains `sendingBank`/`receivingAccount`/`apiRawResponse`/
  `createdAt`, `transRef @unique` (anti-replay); `Entitlement` gains
  `@@index([productId])`. No manual migration SQL (Prisma engine only).
- Mutation split (no schema collision): Phase 012 exposes
  `createSmartOrder(input)` / `verifyPaymentSlip` / `smartOrder`; the legacy
  `createOrder(productIds)` stays owned by Phase 004. REST mirrors under
  `/api/checkout/orders`, `/api/payment/verify-slip`, `/api/storage/upload-slip`.
- Checkout (`CheckoutService`): Zod boundary → product snapshot (published,
  stock-guarded, discount-aware) → address ownership check → live cheapest
  shipping → `$transaction` (order+items, orderNumber retry ×3 on P2002, cart
  clear) → EMVCo PromptPay payload (mobile/national-id/ewallet proxies,
  CRC16) → `stream:order:created`. Coupon value stays 0 until Phase 088/117.
- Slip verify (`SlipVerifyService`, <1s SLA): Redis `setnx` lock (10s,
  fail-closed on Redis outage) → owner-guarded order read → idempotent
  VERIFIED replay → `PAYMENT_VERIFYING`/`PENDING_SLIP` marker → EasySlip
  (800ms abort budget, typed errors, SlipOK-ready seam) → amount/account
  guards → single `$transaction` (slip upsert + order COMPLETED/VERIFIED +
  entitlement upserts) → `slip-verified` + `flex-receipt` events; SLA breach
  emits `monitor:sla-breach` instead of failing post-grant (money moved).
- Slip upload (`SlipUploadService`): magic-byte PNG/JPEG/WebP check (never
  trust contentType), 5MB cap, SigV4 S3 PUT to R2 (global fetch, zero new
  deps), public URL so EasySlip can fetch (zero egress); 503 when R2
  unconfigured (honest degrade).
- Entitlements (`EntitlementGrantService`): idempotent upsert per product
  (dedupe repeat ids), cache invalidate + `entitlement:granted` event;
  `hasAccess` gatekeeper for reader/player.
- Frontend: `PromptPayQrModal` (local `react-qr-code`, zero-egress, 5 states:
  LIFF_INIT skeleton / IDLE / LOADING / SUCCESS unlock sheet / ERROR retry) +
  LIFF/Web `/checkout` pages (cart summary → order → modal) + thin API
  proxies (auth + tenant passthrough). No new deps.

## Consequences
- Fake-timed verify path ~ms (EasySlip mocked); production budget 800ms API +
  200ms transaction; breach alerts instead of post-grant rollback.
- Trade-off: Redis outage fail-closes verification (Conflict) — correct for
  money movement; EasySlip outage marks PENDING_SLIP for SlipOK/manual path.
- Rollback: remove `OrderModule` from `AppModule` to disable; schema is
  additive (enums/columns/indexes only).

## Gates (9/9)
1. SSOT sync (Prisma≡Zod≡GQL≡tests) 2. tsc (0 new backend errors, frontend
clean) 3. 5 checkout/pay UI states 4. transRef @unique + Redis lock 5. QR
modal <20MB (local QR, no ext API) 6. R2 slip vault zero-egress 7. atomic
$transaction (order+slip+entitlements) 8. Redis stream events 9. this ADR.
