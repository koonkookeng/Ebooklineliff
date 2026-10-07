// SSOT Phase 030 §3.1 — Tenant branding + navbar theme Zod SSOT contract
// Canonical: packages/shared/src/schemas/tenant-branding.schema.ts
// (legacy src/shared/schemas/tenant-branding.schema.ts)
// - Spec-verbatim: NavigationBarIconThemeEnum / TenantBrandingSchema /
//   UpdateNavbarThemeInputSchema (pick).
// - RISK_CALL deviations (documented, additive-only):
//   - tenantId is z.string().min(1), not uuid: the runtime tenant key is the
//     slug hint ('default', 'company-a') carried by subdomain/?tenant= and the
//     middleware x-tenant header (Phase 006/021/023–029 precedent); uuid
//     strictness would 400 every LIFF open.
//   - logoUrl is optional (tenants without uploaded logos render brandName);
//     updatedAt optional on input paths (server stamps).
// - Pure WCAG 2.1 contrast engine (BDD Scenario 2): shared by the backend
//   ContrastCalculator and the frontend theme applier (single source).
// - Zero new deps (zod only).
import { z } from 'zod';

export const NavigationBarIconThemeEnum = z.enum(['LIGHT', 'DARK', 'AUTO']);
export type NavigationBarIconTheme = z.infer<typeof NavigationBarIconThemeEnum>;

const hexColor = z
  .string()
  .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid Hex Color');

export const TenantBrandingSchema = z.object({
  tenantId: z.string().min(1),
  brandName: z.string().min(1).max(100),
  logoUrl: z.string().url().optional(),
  primaryColor: hexColor,
  navBarBgColor: hexColor,
  navBarTextColor: hexColor,
  iconTheme: NavigationBarIconThemeEnum.default('AUTO'),
  enableCustomCloseButton: z.boolean().default(true),
  enableShareOptionMenu: z.boolean().default(true),
  updatedAt: z.string().datetime().optional(),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

export const UpdateNavbarThemeInputSchema = TenantBrandingSchema.pick({
  tenantId: true,
  primaryColor: true,
  navBarBgColor: true,
  navBarTextColor: true,
  iconTheme: true,
  enableCustomCloseButton: true,
  enableShareOptionMenu: true,
});
export type UpdateNavbarThemeInput = z.infer<typeof UpdateNavbarThemeInputSchema>;

/** Redis edge key for a tenant theme snapshot (§4.2). */
export function tenantThemeKey(tenantSlug: string): string {
  return `tenant:theme:${tenantSlug}`;
}
/** Theme edge TTL: 24h with invalidation on admin update (§4.2, Gate 7). */
export const TENANT_THEME_TTL_SEC = 86400;
/** Theme analytics channel (§7 navbar_theme_applied / navbar_action_click). */
export const THEME_ANALYTICS_CHANNEL = 'tenant.theme.applied';
/** WCAG 2.1 AA minimum contrast for normal text (BDD Scenario 2). */
export const WCAG_AA_MIN_RATIO = 4.5;

function normalizeHex(hex: string): string {
  const h = hex.trim();
  if (/^#[A-Fa-f0-9]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  }
  return h.toUpperCase();
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance of a hex color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex);
  const r = Number.parseInt(h.slice(1, 3), 16);
  const g = Number.parseInt(h.slice(3, 5), 16);
  const b = Number.parseInt(h.slice(5, 7), 16);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.1 contrast ratio between two hex colors (1–21). */
export function contrastRatio(bgHex: string, fgHex: string): number {
  const l1 = relativeLuminance(bgHex);
  const l2 = relativeLuminance(fgHex);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Auto text/icon color for a navbar background (BDD Scenario 2 fallback):
 * keeps the admin's preferred color when it passes AA, else picks the
 * readable extreme (white/black) with the higher ratio — readability 100%.
 */
export function ensureReadableText(bgHex: string, preferredHex: string): string {
  if (contrastRatio(bgHex, preferredHex) >= WCAG_AA_MIN_RATIO) return normalizeHex(preferredHex);
  return contrastRatio(bgHex, '#FFFFFF') >= contrastRatio(bgHex, '#000000') ? '#FFFFFF' : '#000000';
}

/** Resolve AUTO icon theme from background luminance (dark bg → light icons). */
export function resolveIconTheme(iconTheme: NavigationBarIconTheme, navBarBgColor: string): 'LIGHT' | 'DARK' {
  if (iconTheme !== 'AUTO') return iconTheme;
  return relativeLuminance(navBarBgColor) < 0.4 ? 'LIGHT' : 'DARK';
}
