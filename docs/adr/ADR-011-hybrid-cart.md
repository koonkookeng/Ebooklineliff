# ADR-011 — Smart Hybrid Shopping Cart (Digital/Physical Split + Dynamic Shipping)

- Status: Accepted
- Phase: PHASE-011-HYBRID-CART
- Date: 2026-10-06

## Context
One order mixes instant-access digital goods (ebook/course/bundle: $0 shipping,
instant entitlement) and shippable physical books (weight × zone carrier rates,
address required). LIFF cart drawer + list must stay ≤5MB of the 30MB webview
budget; checkout locks physical stock for 15 min (PromptPay QR expiry).

## Decision
- SSOT: `packages/shared/src/schemas/cart.schema.ts` (item/summary/shipping/add/
  update + `isPhysicalProduct`/`effectiveUnitPrice`) → SDL
  (`api/graphql/schemas/cart.graphql/schema.graphql`) → NestJS → Next.js.
  `ProductTypeEnum` stays owned by `sdid-contract` (zero-redundant).
- Persistence (additive only): `Cart` (1:1 user, tenant, `AbandonedStatus`,
  `lastActivityAt` for the Phase 084 abandoned consumer), `CartItem`
  (`@@unique([cartId, productId])`), `ShippingRateTable` (carrier × zone weight
  brackets), `Product.cartItems` back-relation. Payment-slip logic untouched
  (OUT_OF_SCOPE respected — no hook into `payment-slip.controller`).
- Split rule (single source): `PHYSICAL_BOOK` type OR non-null `physicalDetail`
  → PHYSICAL, else DIGITAL. Digital discounts apply to the digital subtotal
  only and are clamped (never leak into shipping); zero-weight physical falls
  back to the minimum fee (spec Edge Cases 1–3 covered by tests).
- Shipping: `ShippingRateTable` rows win; tiered weight pricing (35/55/85) is the
  offline fallback; quotes cached 1h per carrier×zone×weight; zone from postal
  code (Bangkok 10xxx / deep-south 94–96xxx remote / else upcountry). Adapter
  never throws — degrades to the tiered fee (availability over precision).
- Events (best-effort Redis streams, never block reads/writes): `item-added`,
  `split-calculated`; `lastActivityAt` touched on every mutation so Phase 084
  can fire the 30-min `CART_ABANDONED` Flex-message flow. Checkout stock lock
  (15-min Redlock) lands with the order/checkout phase that owns transactions.
- Frontend: dependency-free external store (`useCartStore`, same shape +
  persist key as the spec's zustand sketch — zero new deps per repo policy,
  localStorage offline read) + `HybridCartDrawer` (digital ⚡ / physical 🚚
  sections, qty steppers, per-section subtotals, address warning, sticky total
  CTA) + LIFF/Web `/cart` pages + API proxies (auth + tenant passthrough).
- No `lucide-react` / shadcn `Card` / `zustand` additions: emoji glyphs + local
  styles keep the LIFF bundle lean (repo has no such deps installed).

## Consequences
- Warm quote path <300ms (single cached lookup per carrier, parallel fan-out).
- Trade-off: rate table is seeded empty → tiered fallback until logistics phase
  (076/077) seeds carrier rows; zone rule is coarse until then.
- Rollback: additive schema only; remove `CartModule` from `AppModule` to disable.

## Gates (9/9)
1. SSOT sync 2. tsc (0 new backend errors, frontend clean) 3. 5 cart UI states
4. stock/owner guards (no over-sell via cart) 5. RAM ≤5MB cart slice
6. R2 cover images 7. atomic cart mutations 8. cart event streams
9. this ADR.
