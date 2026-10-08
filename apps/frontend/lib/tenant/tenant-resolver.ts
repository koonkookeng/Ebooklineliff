// SSOT Phase 071 §6.1 — Dynamic Tenant Engine resolver (edge-safe, zero-dep)
// Canonical: apps/frontend/lib/tenant/tenant-resolver.ts
// (legacy src/frontend/lib/tenant/tenant-resolver.ts)
// - Byte-parity with `resolveTenantIdentifier` / `isCustomDomainIdentifier` /
//   `customDomainOf` in @repo/shared tenant-contract.ts (SSOT); parity enforced
//   by scripts/test-phase071-contracts.ts (no barrel import: keeps the Edge
//   middleware bundle lean, <1ms overhead per §1.1).
// - Precedence: LIFF `?tenant=` query > `<slug>.<baseDomain>` subdomain >
//   custom domain (`custom:<host>`) > `default` (central hub).
// - Edge-safe: no Node APIs, no deps, string ops only.

export const DEFAULT_TENANT_SLUG = 'default';
export const CUSTOM_TENANT_PREFIX = 'custom:';

export interface TenantResolution {
  /** Slug | `custom:<host>` | `default` — forwarded as x-tenant-identifier. */
  identifier: string;
  /** True when routing via a verified custom domain. */
  isCustomDomain: boolean;
  /** True when falling back to the central hub. */
  isDefault: boolean;
}

function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Pure tenant-identifier resolution (<1ms, edge-safe).
 * Mirrors SSOT `resolveTenantIdentifier` byte-for-byte semantics.
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
  return `${CUSTOM_TENANT_PREFIX}${host}`;
}

/** Rich resolution result for middleware + LIFF client binding. */
export function resolveTenant(input: {
  hostname: string;
  queryTenant?: string | null;
  baseDomain?: string;
}): TenantResolution {
  const identifier = resolveTenantIdentifier(input);
  return {
    identifier,
    isCustomDomain: identifier.startsWith(CUSTOM_TENANT_PREFIX),
    isDefault: identifier === DEFAULT_TENANT_SLUG,
  };
}

/** True when the identifier is a custom-domain routing token. */
export function isCustomDomainIdentifier(identifier: string): boolean {
  return identifier.startsWith(CUSTOM_TENANT_PREFIX);
}

/** Strip the `custom:` prefix back to the raw hostname (null otherwise). */
export function customDomainOf(identifier: string): string | null {
  return isCustomDomainIdentifier(identifier) ? identifier.slice(CUSTOM_TENANT_PREFIX.length) : null;
}

/**
 * LIFF client fallback: extract `?tenant=` from a LIFF open URL
 * (e.g. `liff.line.me/200123456-AbCdEfgh?tenant=brand-x&target=ebook`).
 * Returns the slug or null when absent (caller keeps subdomain context).
 */
export function extractTenantFromLiffUrl(url: string): string | null {
  try {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return null;
    const params = new URLSearchParams(url.slice(queryIndex + 1));
    const tenant = (params.get('tenant') ?? '').trim();
    return tenant ? normalizeSlug(tenant) : null;
  } catch {
    return null;
  }
}

/** Redis edge keys (mirror SSOT; used by the backend lookup service). */
export function tenantStatusKey(tenantId: string): string {
  return `tenant:status:${tenantId}`;
}

export function tenantSlugKey(slug: string): string {
  return `tenant:slug:${slug.toLowerCase()}`;
}

export function tenantDomainKey(domain: string): string {
  return `tenant:domain:${domain.toLowerCase()}`;
}
