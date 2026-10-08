# ADR-071 — Dynamic Tenant Engine Middleware & Query Routing

## Status
Accepted (verified 100/100 x3 post-refactor + Phase030/028 regressions green).

## Context
Phase 071 needs subdomain / custom-domain / LIFF `?tenant=` resolution with
<1ms edge overhead, first-ms CSS-var branding, and backend tenant isolation
(9 Golden Gatekeepers). Prior art: Phase 006 Tenant registry, Phase 021 LIFF
ID header, Phase 023 header integrator, Phase 030 navbar branding.

## Decision
- **SSOT**: `tenant-contract.ts` keeps spec-verbatim Zod (§3.1); barrel aliases
  (`TenantEngineBrandingSchema`) avoid the Phase 030 `TenantBranding` collision.
- **Prisma expand-contract**: `TenantStatus` + `TenantDomain` +
  `TenantBrandingConfig` + `UserTenantMapping`; `Tenant` gains status +
  relations. `Tenant.orders[]` deliberately omitted until `Order.tenant` FK
  backfill lands (one-sided `Order.tenantId` stays).
- **Edge**: `tenant-resolver.ts` is zero-dep byte-parity with SSOT (no barrel
  import in middleware — bundle stays lean); middleware sets
  `x-tenant-identifier` + `x-tenant-id` and does **not** rewrite to
  `/_tenants/<id>` (route tree does not exist; rewrite would 404).
- **Backend**: `TenantGuard` (fail-closed 401 on missing/suspended/outage) +
  `TenantHeaderInterceptor` (echo, passive on public) + `TenantResolverService`
  (Redis-first, DB refill, hub synthesis, unverified-domain 404).
- **Hub**: `default` resolves ACTIVE with synthetic nil-UUID branding so the
  LIFF shell never 404s itself.

## Consequences
- Guard is opt-in per controller (`@UseGuards(TenantGuard)`); public branding
  endpoints stay unauthenticated for first-ms hydration.
- Follow-ups: seed hub Tenant row (optional), Phase 072 storefront
  tenant admin, custom-domain CNAME/SSL verification job (§8).
