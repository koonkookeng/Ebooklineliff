# ADR-009 — Product Catalog API, Dynamic Faceted Filter & Predictive Search

- Status: Accepted
- Phase: PHASE-144-XZ-009
- Date: 2026-10-06

## Context
Catalog discovery must serve 5 product types with sub-50ms predictive search on LINE LIFF
(<30MB RAM), faceted filtering (<80ms), tenant isolation, and zero-egress images (R2 CDN).

## Decision
- SSOT: `packages/shared/src/schemas/product-search.schema.ts` (Zod) → GraphQL SDL
  (`apps/backend/src/api/graphql/schemas/product.graphql/schema.graphql`) → NestJS
  handlers → Next.js UI. No duplicated interfaces (zero-redundant policy).
- Persistence: extend `Product` additively (`ratingAverage`, `reviewCount`,
  `embedding vector(768)`, `searchVector tsvector`); keep `ProductCategoryMap`
  (no rename) to preserve Phase 008 compatibility. Idempotent SQL indexes in
  `apps/backend/src/infra/postgres/product-search-indexes.sql` (trigram GIN +
  tenant/type B-tree + HNSW cosine).
- Read path: `RedisSearchCacheAdapter` (catalog 60s TTL, predictive 30s TTL) →
  `PrismaProductSearchRepository` (parallel `findMany` + `count` + `groupBy`
  productType). FTS via Prisma `contains insensitive` (index-backed); pgvector
  HNSW as semantic fallback with RRF fusion (`vector-search.engine.ts`).
- Abuse control: 30 predictive req/min per LINE user (sliding window in Redis,
  fail-open); query sanitization (trim/collapse/strip controls, 100 chars).
- Analytics: zero-result terms → `stream:search:zero-results`; clicks →
  `stream:search:click` (best-effort publish, never blocks reads).
- Frontend: `PredictiveSearchBar` (150ms debounce, AbortController, React 19
  `useTransition`, max 5 rows, history in localStorage, 5 UI states, tenant CSS
  vars) + `FacetedFilterDrawer` (URL-synced, no full re-render) + shared
  `lib/product-search.ts` fetcher (ISR 60s). No `@tanstack/react-virtual`
  dependency — windowing achieved by hard-capping rows (simpler, LIFF-safe).
- No new runtime deps (`@nestjs/cqrs` avoided — CQRS-lite DTO+handler pattern
  matching Phase 008 UseCase style).

## Consequences
- p50 predictive on Redis hit <5ms; on miss single indexed Prisma query + parallel
  facets; RRF keeps semantic fallback optional (no embedding service required).
- Trade-off: Thai full-text uses trigram fallback (no Thai `tsvector` dict on
  managed PG); acceptable until `pgroonga` approved.
- Rollback: additive schema only; drop new providers from `CatalogModule` to
  disable; cache keys versioned by content (`search:catalog:*`).

## Gates (9/9)
1. SSOT sync (Zod/GQL/Prisma) 2. tsc strict 3. 5 UI states 4. rate-limit+sanitize
5. RAM <30MB (5-row cap) 6. R2 images 7. indexed queries <50/80ms
8. zero-result stream 9. this ADR.
