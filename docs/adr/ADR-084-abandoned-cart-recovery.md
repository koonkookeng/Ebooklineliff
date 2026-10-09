# ADR-084: Abandoned Cart Recovery Messaging

## Status
Accepted — Phase 084 DONE (verified 100/100 x3).

## Context
Phase 084 spec requires idle detection, delayed two-step Flex nudges with
dynamic coupons, HMAC magic-link recovery, and funnel analytics — naming
BullMQ, a couponCode table, and a 3rd notification step that all conflict
with repo SSOT (no BullMQ dep, 088/117 own coupons, schema.md has 2 steps).

## Decision
- **Queue without BullMQ:** delays emerge from `lastActivityAt` math + a
  15-min Redis watch key; `drainDue(step)` is cron/admin invocable,
  per-cart mutexed, idempotent. Same observable behavior, zero new deps.
- **Codeless coupons:** truth = `AbandonedCartLog.couponCode` + campaign
  rule (10%/15%, 2h TTL). No parallel coupon table; 088/117 untouched
  (test-asserted). `Zod` status/step enums follow the Prisma union
  (no CHECKOUT_STARTED, 2 steps — spec-text deviations documented).
- **Delivery port:** `LogOnlyLinePush` default (records + stream, synthetic
  id, 3-attempt backoff). Swapping in a LINE OA sender is one provider
  line — no tenant template exists in the 024 vocabulary today, so direct
  reuse would always throw. Stated plainly.
- **Recovery:** HMAC magic links (2h TTL, ticket-is-auth), atomic
  RECOVERED + click-through txn <500ms, graceful expired/empty shapes
  (never 500). Server restores the DB cart; the LIFF entry is additive
  (011 cart page untouched).
- **Price snapshots:** `CartItem.price` nullable additive; live Product
  price is the fallback.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state recovery
  sheet, HMAC + 2-message cap + mutexes, lean client, R2 Flex images,
  atomic recovery txn, recovery stream, this ADR.
- Regression: 084 x3 + 083/082 green; backend/frontend typecheck clean;
  bundle guard PASS.
