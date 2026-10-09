# ADR-089: Mini App Gift Center

## Status
Accepted — Phase 089 DONE (verified 100/100 x3).

## Context
Phase 089 spec wants gift purchase, Flex sharing, atomic claims, and
expiry reversion — while payment core is read-only, no vision/Apollo/
shadcn deps exist, and entitlement grants already have a single writer.

## Decision
- **Payment seam:** gifts are created PENDING_PAYMENT with NULLABLE
  orderId and flip to READY_TO_CLAIM on `bindGiftPayment` (sender
  checkout calls it later). No order/payment code touched.
- **One grant writer:** claim and expiry both call the 012
  `EntitlementGrantService` inside their own transactions (wallet-module
  provision precedent). No duplicate grant logic.
- **Single-claim:** Redis mutex (409 on race) + READY/window guards with
  graceful used/expired/self shapes (never 500); self-gifting refused.
- **Human codes:** `GIFT-<base36>-<rand4>` (unique, typeable, Flex-nice).
- **Client:** REST + `window.liff` (no Apollo), native inputs (no
  shadcn), no animation libs (Gate 5). Claim-to-reader redirect closes
  the loop inside the 1s budget.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state gift
  flows, mutex + HMAC-free code auth + RBAC, lean client, R2 covers,
  atomic claim/revert txns, gift stream (K-factor), this ADR.
- Regression: 089 x3 + 088/087 green; backend/frontend typecheck clean;
  bundle guard PASS.
