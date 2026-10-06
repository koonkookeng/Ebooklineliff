# ADR-008: Multi-Format Product Catalog (Schema + DDD)

- Status: Accepted (Atomic Phase 008, PHASE-144-XZ-008)
- Date: 2026-10-06
- SSOT: `packages/db/prisma/schema.prisma` (catalog segment) +
  `packages/shared/src/schemas/catalog.zod.ts`

## Context

Catalog must hold 4 formats (physical / ebook / course / hybrid bundle) multi-tenant,
type-safe end to end, with atomic bundle writes and soft-delete that never strands
fulfillment stock.

## Decision

1. **Single-table Product + per-type 1:1 details + self-referential BundleItem.**
   No STI/JSON blobs: queries stay indexed (`tenantId`, `productType`, `status+isPublished`,
   `slug`) and relations cascade on delete.
2. **Tenant optional until backfill** (same expand-contract as `User.tenantId` in ADR-006);
   list queries always filter by tenant when provided. `Tenant.products[]` +
   `customCssVars` added for storefront branding.
3. **Money in satang at the domain boundary** (`money.vo`): Prisma `Decimal(10,2)` converts
   once in the mapper — no float drift in prices/discounts.
4. **Stock guards in the entity, enforced in a transaction** (`assertReservable`;
   `reservedQty ≤ stockQty` on every write). No oversell, no stranded reservations.
5. **Soft-delete = unpublish + timestamp.** Stock rows are untouched; discovery
   invalidates via a versioned list-cache generation (`catalog:ver:{tenant}` bump → <100ms
   convergence) instead of expensive key scans.
6. **Payload striping server-side** (`LIST_SELECT`): list cards exclude `description` and
   bulk detail fields for the 30MB LIFF RAM budget; PDP (`getBySlug`) is the only full
   payload and is edge-cached 300s.
7. **No `prisma migrate dev` in this environment** (OUT_OF_SCOPE + no live DB here):
   schema is `validate`d + `generate`d; the migration runs in CI/deploy against the real
   database (`prisma migrate deploy`). No hand-written SQL, per repo policy.
8. **Code-first GraphQL** (`autoSchemaFile`): catalog SDL derives from the resolver —
   the empty `catalog.graphql` scaffold dirs are left for later-phase documents.

## Consequences

- `CatalogModule` owns repository → use-cases → GraphQL + REST (`/admin/catalog`,
  seller-guarded); `GET /admin/catalog` doubles as the stripped storefront list.
- Events `product.created` / `stock.reserved` (+ `product.unpublished`) publish
  best-effort to `catalog-events` for CTR/recommendation pipelines.
- Follow-ups: `Product.searchVector` (pg full-text, needs `fullTextSearchPostgres`
  preview) when catalog exceeds scan-friendly size; tenantId required + backfill.
