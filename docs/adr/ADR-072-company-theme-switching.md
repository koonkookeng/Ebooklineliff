# ADR-072 — Company Theme Switching (Dynamic Primary Color, Logo, Typography)

## Status
Accepted (verified 100/100 x3 post-refactor + Phase066/071/030/028 regressions green).

## Context
Phase 072 needs realtime multi-tenant theme switching (<15ms, zero-FOUC,
WCAG AA, LIFF RAM <30MB). Prior art already covers slices: Phase 030 navbar
branding (TenantBranding + contrast engine + 24h cache), Phase 071 tenant
resolution (slug/custom/query + guard + middleware headers). 072 adds the
FULL company theme (surfaces, logo set, typography, radius).

## Decision
- **SSOT**: `theme-contract.ts` keeps spec-verbatim Zod (§3.1); contrast
  engine REUSED from tenant-branding.schema (no second implementation);
  barrel names are collision-free (verified).
- **Prisma expand-contract**: `CompanyTheme` 1:1 with `Tenant.themeConfig`
  (spec-verbatim columns). No Tenant rewrite — additive relation only.
- **Backend**: `CompanyThemeService` (Redis `tenant:company-theme:{slug}` 24h,
  DB fallback + sanitized refill, Zod-gated upsert, slug invalidation via
  id→slug lookup) + public GET / JWT PUT REST + code-first
  `getTenantTheme`/`updateTenantTheme` (distinct ObjectTypes) + SDL record.
  Wired into `TenantResolverModule` (tenant engine home).
- **Edge**: middleware keeps the 071 resolver (superset of the 072 §6.1
  sketch) + additive `x-tenant-slug` compat header. No rewrite, no regression.
- **Frontend**: `company-theme-client` (Zod-gated fetch, FontFace preload w/
  800ms fallback, font/blob cleanup) + `DynamicThemeProvider` (THEME_*
  5-state, skeleton, Ahong Emerald error fallback) mounted in (liff) +
  new (web) layout; `styles/globals.css` holds plain-CSS tokens (no Tailwind
  dep — no `@theme` directives); `app/globals.css` re-exports it.
- **Watermark**: link-only (`watermarkLogoFor`) — canvas algorithm untouched
  per OUT_OF_SCOPE.

## Consequences
- `lib/theme/theme-client.ts` (Phase 066) stays byte-identical — 072 client
  lives in `company-theme-client.ts` (Surgical Changes).
- Follow-ups: visual-regression snapshots (§10), CNAME/SSL verify job (§8),
  SSR inline-style hydration via initialTheme prop (prop exists, unused yet).
