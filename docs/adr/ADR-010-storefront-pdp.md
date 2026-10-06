# ADR-010 — Storefront Home & Universal PDP (Multi-Tenant, <30MB, Zero-Egress)

- Status: Accepted
- Phase: PHASE-010-STORE-PDP
- Date: 2026-10-06

## Context
Discovery needs a tenant-themed storefront home (hero + quick links + feed) and a
universal PDP rendering all 4 formats (physical/ebook/course/bundle) on LINE LIFF
(<30MB RAM, TTI <100ms) and web responsive, with R2 zero-egress images.

## Decision
- SSOT: `packages/shared/src/schemas/storefront.schema.ts` (banner/quick-link/card/
  detail/feed + `effectivePrice`/`discountPercent` satang-safe helpers) → SDL
  (`api/graphql/schemas/storefront.graphql/schema.graphql`) → NestJS → Next.js.
  `ProductTypeEnum` stays owned by `sdid-contract` (zero-redundant).
- Persistence (additive only): `Product.isFeatured`/`soldCount` + composite indexes
  (`[sellerId,isPublished]`, `[productType,isPublished]`, `[isFeatured,isPublished]`,
  `[soldCount]`) + new `Banner` model (tenant hero carousel). No renames; Phase 008/009
  queries untouched.
- Read path: `StorefrontService` (feed: 5 parallel queries, 300s TTL; PDP:
  tenant-scoped cache key `storefront:pdp:{tenant}:{slug}`; predictive top-5).
  `Banner`/`Category` accessed via defensive client casts so the service stays
  operable before/after `prisma generate`. Impression events fire-and-forget to
  `stream:storefront:impression` (never blocks reads).
- Tenant isolation: PDP cache key is tenant-scoped (a cache hit can never leak a
  product across tenants); explicit `tenantId` mismatch → 404.
- Middleware: `/`, `/pdp/*`, `/catalog*`, `/api/search*`, `/api/storefront*` are
  public discovery routes (branding-only, no login redirect); all other rules
  unchanged.
- Frontend: `StorefrontHome` (skeleton/empty/error states, 20-card cap, R2 `<img>`
  lazy), `ProductDetailPage` (format-specific blocks: ebook sample CTA, course
  curriculum tabs, physical stock/shipping, sticky buy bar), `PreviewModal`
  (signed-URL ready, 15-min notice, null-safe empty state), shared `lib/storefront.ts`
  (ISR 60s) + API proxies. No new runtime deps.
- No `@tanstack/*` virtualization: row caps + lazy images keep LIFF <30MB (simpler).

## Consequences
- Feed p50 <20ms on cache hit; PDP cache is tenant-safe by construction.
- Trade-off: `isBestseller` is threshold-derived (`soldCount >= 50`) rather than a
  ranked job — acceptable until the analytics bestseller pipeline (Phase 052) lands.
- Rollback: additive schema only; remove `Storefront*` providers/controller from
  `CatalogModule` to disable.

## Gates (9/9)
1. SSOT sync 2. tsc (0 new backend errors, frontend clean) 3. 5 UI states
4. preview-modal signed-URL contract 5. RAM <30MB (caps+lazy) 6. R2 images
7. Redis feed/PDP <20ms 8. impression stream 9. this ADR.
