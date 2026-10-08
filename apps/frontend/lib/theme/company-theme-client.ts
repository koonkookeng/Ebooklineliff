// SSOT Phase 072 §6/§10 — Company theme client (fetch + font lifecycle)
// Canonical: apps/frontend/lib/theme/company-theme-client.ts
// (NOT theme-client.ts — that is Phase 066 reading-preference transport.)
// - fetchCompanyTheme: Zod-gated GET via the Next proxy (5-min in-memory
//   cache per slug; stale-while-revalidate is unnecessary — CSS vars apply
//   synchronously after parse, <15ms budget §1.1).
// - preloadTenantFont: FontFace preload with 800ms system-font fallback
//   (§10 self-heal); unloadTenantFont drops prior FontFace entries and
//   revokes blob URLs (BDD-3 RAM discipline, LIFF <30MB).
// - Zero-dep (DOM + fetch only).
import {
  AHONG_EMERALD_FALLBACK,
  COMPANY_THEME_FONT_TIMEOUT_MS,
  CompanyThemeConfigSchema,
  buildCompanyThemeCssVars,
  type CompanyThemeConfig,
} from '@repo/shared';

const themeCache = new Map<string, { theme: CompanyThemeConfig; at: number }>();
const THEME_CACHE_MS = 5 * 60 * 1000;
let activeFontFamily: string | null = null;

/** Fetch + Zod-gate a company theme (fallback: Ahong Emerald, never throws). */
export async function fetchCompanyTheme(slug: string): Promise<CompanyThemeConfig> {
  const key = (slug ?? '').trim().toLowerCase() || 'default';
  const hit = themeCache.get(key);
  if (hit && Date.now() - hit.at < THEME_CACHE_MS) return hit.theme;
  try {
    const res = await fetch(`/api/v1/tenant/company-theme?slug=${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return AHONG_EMERALD_FALLBACK;
    const parsed = CompanyThemeConfigSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return AHONG_EMERALD_FALLBACK;
    themeCache.set(key, { theme: parsed.data, at: Date.now() });
    return parsed.data;
  } catch {
    return AHONG_EMERALD_FALLBACK;
  }
}

/** Apply the full Tailwind-v4 + 071-compat token set on :root (zero-FOUC). */
export function applyCompanyThemeVars(theme: CompanyThemeConfig): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(buildCompanyThemeCssVars(theme))) {
    root.style.setProperty(k, v);
  }
  root.dataset['tenantTheme'] = theme.tenantId;
}

/**
 * Preload a tenant webfont with an 800ms system-font fallback (§10).
 * Unloads the previous tenant family first (RAM discipline, BDD-3).
 */
export async function preloadTenantFont(theme: CompanyThemeConfig): Promise<void> {
  if (typeof document === 'undefined') return;
  unloadTenantFont();
  const url = theme.typography.fontUrl;
  const family = theme.typography.fontFamily;
  if (!url) return;
  activeFontFamily = family;
  try {
    if ('FontFace' in window) {
      const face = new FontFace(family, `url(${url}) format('woff2')`, { display: 'swap' });
      const loaded = await Promise.race([
        face.load(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('font timeout')), COMPANY_THEME_FONT_TIMEOUT_MS),
        ),
      ]);
      document.fonts.add(loaded);
    } else {
      await injectFontLink(url);
    }
  } catch {
    // Fallback: system stack already applies via --font-tenant; never block.
    activeFontFamily = null;
  }
}

/** Drop prior tenant fonts + revoke blob URLs (BDD-3 memory guard). */
export function unloadTenantFont(): void {
  if (typeof document === 'undefined' || !activeFontFamily) return;
  try {
    for (const face of Array.from(document.fonts)) {
      if (face.family === activeFontFamily) document.fonts.delete(face);
    }
  } catch {
    // Best-effort; older WebViews may lack delete().
  }
  try {
    for (const link of Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[data-tenant-font]'),
    )) {
      const href = link.href;
      if (href.startsWith('blob:')) URL.revokeObjectURL(href);
      link.remove();
    }
  } catch {
    // Best-effort cleanup.
  }
  activeFontFamily = null;
}

function injectFontLink(url: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), COMPANY_THEME_FONT_TIMEOUT_MS);
    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset['tenantFont'] = '1';
      link.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      link.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      document.head.appendChild(link);
      setTimeout(() => resolve(), COMPANY_THEME_FONT_TIMEOUT_MS + 50);
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}
