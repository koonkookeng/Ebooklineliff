# ADR-023: Dynamic Header Title Integrator

- Status: Accepted (Atomic Phase 023, PHASE-144-XZ-023)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/header-contract.ts` + `packages/db/prisma/schema.prisma`
  (`HeaderConfig`, `TenantBranding`) + `apps/backend/src/api/graphql/schemas/header.graphql/schema.graphql`

## Context

Header text must follow reading/learning context in real time (book/chapter, course/lesson,
live room) on both LINE native chrome and custom web topbars, with per-product overrides and
tenant branding — without new dependencies, without re-rendering page content, and with
header metadata served in microseconds from the edge.

## Decision

1. **Deliberate spec deviations (RISK_CALL, all documented here)**:
   - `tenantId` is `z.string().min(1)`, not `uuid`: `Product.tenantId`/`sellerId` and the
     middleware tenant hints use opaque slugs (`'default'`), consistent with the Phase 021/022
     contracts. UUID-only would reject every real tenant.
   - No `zustand` / `lucide-react`: neither is in `apps/frontend` deps. A dependency-free
     `useSyncExternalStore` header store (same state shape + selector API as the spec) and
     inline SVG icons honor the zero-new-deps policy and the LIFF RAM budget (Phase 011
     precedent).
   - Redis via `RedisClusterService` (`get`/`setex`), not `RedisService`: the former is the
     canonical backend client used by 20+ services.
   - `displayMode` mapping extended: `LIVE_CLASS → LIVE_STREAM`, other types → `DEFAULT_STORE`.
   - `liff.setTitle` is not part of the installed `@line/liff` v2.22 typings: invoked only via
     guarded dynamic import with optional chaining; `document.title` (plain-text assignment,
     inherently XSS-safe) is authoritative and the native call is best-effort.
2. **Cache-first service** (`HeaderService`): edge hit returns with zero DB touch (<5ms);
   miss computes from SSOT relations (`EbookChapter.chapterIndex`, nested course
   sections/lessons), applies `HeaderConfig` overrides, persists 1h, and self-heals corrupt
   entries. Mutation path upserts config, invalidates the key, returns fresh context.
3. **Render isolation**: `DynamicHeaderIntegrator` is `memo` + CSS containment
   (`contain: layout style paint`); null config renders null, so mounting it in the `(liff)`
   layout is zero-impact until a page sets context. ERROR state falls back to the tenant
   storefront title with a non-blocking note.
4. **Prisma expand-contract**: `HeaderConfig` (1:1 per product, cascade delete) and standalone
   `TenantBranding` appended; no hand-SQL.

## Consequences

- Chapter/lesson navigation can sync header + native title with one store update; metadata
   rides the edge cache with no egress.
- Follow-up (out of scope): client fetch call site against `getHeaderContext` from reader
   pages/HLS player; `HEADER_TITLE_VIEW_CHANGE` dwell-time pipeline (Phase 052 owner).
