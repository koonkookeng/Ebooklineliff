# ADR-073 — Unified Multi-Tenant Merchant Dashboard

## Status
Accepted (verified 100/100 x3 post-refactor + Phase072/071/012 regressions green).

## Context
Phase 073 needs a seller/instructor web workspace: multi-format product
studio, fulfillment, 3% e-Withholding payouts, tenant-isolated analytics.
Prior art owns the heavy engines (008 catalog, 010 storefront, 012 orders,
036 R2 vault, 043/044 transcode, 052 heatmap, 071 tenant guard/resolver).
073 integrates them without duplication.

## Decision
- **SSOT**: `merchant-contract.ts` keeps spec-verbatim Zod (§3.1);
  `ProductTypeEnum` reused from sdid-contract; pure payout math
  (50000 → 1500 + 10 → 48490) is the single decimal-2 source.
- **Prisma expand-contract**: `FulfillmentStatus`/`PayoutStatus` +
  `MerchantProfile`/`Warehouse`/`OrderFulfillment`/`PayoutTransaction`/
  `MerchantAnalyticsDaily` (spec-verbatim; courierName NOT unique — spec
  erratum fixed) + `User.merchantProfile` / `Order.fulfillment` backs.
- **Backend**: scaffold dirs implemented as designed (tax service, 3
  port-based use-cases, structural Prisma repo with `$transaction` payout,
  dual REST controllers behind JwtAuthGuard+TenantGuard+role check,
  code-first GQL + SDL, `MerchantModule` in AppModule). Transcode stays in
  043/044 — studio hands off by R2 objectKey.
- **Frontend**: new `(dashboard)/merchant` group (shell + 6 pages + role
  sidebar + hook + client + 5 tenant-forwarding proxies + CSS). Zero-dep:
  no TanStack/Tremor/Lucide (CSS bars/tables instead — LIFF-safe, no new
  deps). LIFF layouts untouched per OUT_OF_SCOPE.
- **AI Co-Pilot**: stays in 092/094 — dashboard links later (Zero Redundant).

## Consequences
- `MerchantModule` renamed from scaffold `MerchantModuleModule` (no
  importers existed — verified).
- Follow-ups: seed merchant demo profile, visual snapshots, Phase 078/081
  own course-studio/finance depth.
