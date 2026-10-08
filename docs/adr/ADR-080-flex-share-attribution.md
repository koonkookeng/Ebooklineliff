# ADR-080: One-Click LINE Flex Share + HMAC Click Attribution

## Status
Accepted — Phase 080 DONE (verified 100/100 x3).

## Context
Phase 080 spec (§8.1/Gate 9) requires one-click Flex card sharing with
HMAC-SHA256 signed referral tokens, real-time click attribution (<300ms),
10/min generation rate limiting, and sharer metrics — without touching the
payment slip verifier or canvas reader memory management (OUT_OF_SCOPE).
The 026 (social-share) and 079 (affiliate) modules already own the
`generateProductFlexShare` GQL field name and the money ledger.

## Decision
- **Token:** `base64url(userId:productId:affiliateCode:issuedAt:hmac)`,
  timing-safe verify, 30-day TTL (BDD-2). Recipient entry URL is the PDP with
  `?refToken=`; the share entry page tracks the click then routes.
- **Card:** mega-bubble builder (hero cover + URI action, badge/title/desc,
  price with discount strike-through, tenant-colored CTA), 50KB LINE ceiling
  guard. Covers stay on R2/Resizer CDN (<200KB WebP, Gate 6).
- **No GQL collision:** `ShareResolver` exposes only `trackAffiliateClick`
  (public intake) + `getAffiliateShareMetrics` (authed); generation rides
  `GenerateFlexShareUseCase` via REST — documented RISK_CALL deviation.
- **Attribution:** invalid/expired/unknown tokens → `success:false` (never
  throws, never 500); self-click (visitor LINE == sharer LINE) → blocked +
  fraud stream, order still processable. Click rows + `clickCount++` run in
  one `$transaction` (Gate 7); 30-day Redis sessions give `isNewSession`;
  click/share/fraud streams fan out best-effort (Gate 8).
- **Rate limit:** 10/min per user inside the use-case (403 over budget).
- **LIFF client:** `window.liff` global + REST proxies, clipboard fallback —
  no `@line/liff`/`@apollo/client` deps (RAM <30MB, Gate 5). 5-state hook,
  ERROR shows copy-shortlink modal (<50ms fallback switch).
- **P2002 retry:** `refToken` embeds `Date.now`; a same-ms double submit
  re-signs once and rewrites both card CTAs.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state share UI,
  HMAC + self-block + rate limit, lean client, R2 zero-egress, atomic
  click ledger, Redis click/share streams, this ADR.
- Regression: Phase 080 x3 + Phase 079 green; backend/frontend typecheck
  clean; bundle guard PASS. Conversion marking stays with the order/079
  payout path — this module never writes money.
