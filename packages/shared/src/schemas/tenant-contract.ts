// SSOT Phase 071 §3.1 — Dynamic Tenant Engine Zod SSOT contract
// Canonical: packages/shared/src/schemas/tenant-contract.ts
// (legacy src/shared/schemas/tenant-contract.ts)
// - Spec-verbatim: TenantStatusEnum / TenantBrandingSchema /
//   TenantContextResolverSchema (§3.1 Gate 1 SSOT sync).
// - RISK_CALL notes (additive-only, documented):
//   - TenantBrandingSchema.tenantId stays z.string().uuid() per spec (it is the
//     Tenant.id PK; slug resolution happens in tenant-resolver + backend lookup).
//     Callers holding only a slug must resolve via TenantResolverService first.
//   - Hex regex fixed to /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/ (spec draft had an
//     escaped typo `\[A-F...`; semantics unchanged).
// - Pure helpers: slug normalize, identifier resolution order
//   (query > subdomain > custom > default), Redis edge keys, <1ms budgets.
// - Zero new deps (zod only).
import { z } from 'zod';

export const TenantStatusEnum = z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_SETUP', 'ARCHIVED']);
export type TenantStatus = z.infer<typeof TenantStatusEnum>;

const hexColor = z
  .string()
  .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid Hex Color');

export const TenantBrandingSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string().min(2),
  brandName: z.string().min(1),
  logoUrl: z.string().url(),
  faviconUrl: z.string().url().optional(),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  accentColor: hexColor,
  customFontUrl: z.string().url().optional(),
  customDomain: z.string().nullable().optional(),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

export const TenantContextResolverSchema = z.object({
  hostname: z.string(),
  queryTenantParam: z.string().optional(),
  resolvedTenantId: z.string().uuid(),
  isCustomDomain: z.boolean(),
  resolvedAt: z.string().datetime(),
});
export type TenantContextResolver = z.infer<typeof TenantContextResolverSchema>;

/** Resolver input: raw edge request parts (all strings, edge-safe). */
export const TenantResolveInputSchema = z.object({
  hostname: z.string().min(1),
  queryTenant: z.string().min(1).optional(),
  baseDomain: z.string().min(1).default('omnichannel.com'),
});
export type TenantResolveInput = z.infer<typeof TenantResolveInputSchema>;

/** Resolved identifier before DB/Redis lookup (slug | `custom:<host>` | `default`). */
export const TenantIdentifierSchema = z.string().min(1);
export type TenantIdentifier = z.infer<typeof TenantIdentifierSchema>;

/** Edge middleware overhead budget: <1ms resolver (§1.1, §10 perf guard). */
export const TENANT_RESOLVER_BUDGET_MS = 1;
/** Perf-guard tripwire: self-heal to in-memory hash cache above this (§10). */
export const TENANT_RESOLVER_SELFHEAL_MS = 1.5;
/** Tenant status edge TTL: 24h (Phase 030 precedent; invalidated on admin update). */
export const TENANT_STATUS_TTL_SEC = 86400;
/** Custom-domain lookup edge TTL: 24h. */
export const TENANT_DOMAIN_TTL_SEC = 86400;
/** Tenant analytics stream channel (§7 tenant-scoped events). */
export const TENANT_EVENT_CHANNEL = 'tenant.events';
/** Default tenant fallback slug (central hub). */
export const DEFAULT_TENANT_SLUG = 'default';

/** Redis edge key: tenant active-status flag (`ACTIVE` | other). */
export function tenantStatusKey(tenantId: string): string {
  return `tenant:status:${tenantId}`;
}
/** Redis edge key: slug -> tenant id lookup. */
export function tenantSlugKey(slug: string): string {
  return `tenant:slug:${slug.toLowerCase()}`;
}
/** Redis edge key: custom domain -> tenant id lookup. */
export function tenantDomainKey(domain: string): string {
  return `tenant:domain:${domain.toLowerCase()}`;
}
/** R2 vault prefix for tenant-isolated media (§8). */
export function tenantVaultPrefix(tenantId: string): string {
  return `tenants/${tenantId}/`;
}

function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Pure tenant-identifier resolution (edge-safe, no I/O, <1ms).
 * Precedence: LIFF `?tenant=` query > `<slug>.<baseDomain>` subdomain >
 * custom domain (`custom:<host>`) > `default`.
 */
export function resolveTenantIdentifier(input: {
  hostname: string;
  queryTenant?: string | null;
  baseDomain?: string;
}): string {
  const base = (input.baseDomain ?? 'omnichannel.com').toLowerCase();
  const host = input.hostname.trim().toLowerCase().split(':')[0];
  const query = (input.queryTenant ?? '').trim();
  if (query) return normalizeSlug(query);
  if (!host || host === base || host === 'localhost' || host.startsWith('localhost:')) {
    return DEFAULT_TENANT_SLUG;
  }
  if (host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(`.${base}`.length)).split('.')[0];
    return sub ? normalizeSlug(sub) : DEFAULT_TENANT_SLUG;
  }
  return `custom:${host}`;
}

/** True when the identifier is a custom-domain routing token. */
export function isCustomDomainIdentifier(identifier: string): boolean {
  return identifier.startsWith('custom:');
}

/** Strip the `custom:` prefix back to the raw hostname. */
export function customDomainOf(identifier: string): string | null {
  return isCustomDomainIdentifier(identifier) ? identifier.slice('custom:'.length) : null;
}
