# ADR-024: LINE Native Service Message Dispatcher Engine

- Status: Accepted (Atomic Phase 024, PHASE-024-SERVICE-MSG)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/service-message-contract.ts` + `packages/db/prisma/schema.prisma`
  (`TenantLineConfig`, `ServiceMessageTemplate`, `NotificationLog`, `MessageType`,
  `DispatchStatus`) + `apps/backend/src/api/graphql/schemas/service-message.graphql/schema.graphql`

## Context

Transactional notifications (order confirmation, payment receipt, ebook/course grants,
shipping tracking, OTP) must reach LINE users with zero broadcast fee, <300ms dispatch
latency, and 10k msg/sec headroom — surviving LINE 429/5xx via retry + fallback routing,
without touching payment/slip core (OUT_OF_SCOPE_STRICT) and without new dependencies.

## Decision

1. **Deliberate spec deviations (RISK_CALL, all documented here)**:
   - `tenantId`/`userId` are `z.string().min(1)`, not `uuid`: tenant hints use opaque slugs
     (`'default'`) and user ids flow as strings at the edge (Phase 023 precedent).
   - `lineUserId` is `min(1)`, not `min(10)`: dev/mock flows use short ids; real LINE UIDs pass anyway.
   - `templateId` optional in the dispatch payload: resolved server-side via the
     `@@unique([tenantId, messageType])` template, so callers (order/slip triggers) never
     hardcode template ids; explicit mismatch is rejected.
   - No BullMQ (`@nestjs/bull`/`bullmq` are not in backend deps): `NotificationLog` rows are
     the queue (Phase 019 receipt-queue precedent) with inline drive + `drainQueued` sweeper,
     exponential backoff `[1s, 2s, 4s]` (max 3 attempts), and Redis-backed circuit breaker
     (5 consecutive tenant failures → OPEN → `FALLBACK_SENT` + SRE alert). The legacy
     `apps/backend/src/jobs/processors/message-dispatcher.processor.ts` path re-exports the
     canonical processor (single worker ownership, no duplicate workers).
   - HMAC helpers live in decorator-free `delivery-ticket.util.ts` (re-exported by the
     controller): `tsx`/esbuild cannot parse NestJS parameter decorators without
     `experimentalDecorators`, so pure functions are isolated for contract testability.
2. **Dispatch pipeline** (`LineServiceMessageService` → `MessageDispatcherProcessor` →
   `LineApiClient`): config gate → active-template resolve → `QUEUED` log row
   (`costAmount: 0.0000`) → stream event → inline drive. `FlexBuilderService` compiles
   `{{var}}` templates through the `flex-container.vo` guard (bubble/carousel root, R2 image
   ≤500KB heuristic); missing params stay placeholders (preview-safe).
3. **Error taxonomy**: 429/5xx/timeout → retryable; 4xx → permanent (no poison retries);
   terminal exhaustion → `FAILED` then `FALLBACK_SENT` (in-app event) so the LIFF shell can
   surface it. `NotificationDispatchRequestedEvent` is the order/slip trigger seam.
4. **Security**: `fallbackPhone` is SHA-256 hashed before persistence (PDPA/GDPR); delivery
   callbacks are HMAC-gated fail-closed (`timingSafeEqual`, unknown/forged → 404, no log-id
   oracle); channel tokens never logged.
5. **Prisma expand-contract**: three models + two enums appended; no hand-SQL; client
   regenerated via `prisma generate`.

## Consequences

- Order/slip modules trigger zero-cost LINE Flex notifications with one service call; all
  delivery states are observable via the admin console (`stats` + `logs`) and Redis streams.
- Follow-up (out of scope): LINE Service Message (LNM) `serviceMsgServiceId` activation per
  tenant; SMS-gateway fallback channel beyond in-app events; CTR short-URL gateway
  (`/r/:linkId`) analytics (Phase 052 owner).
