// SSOT Phase 072 §3.1 — Company Theme Switching Zod SSOT contract
// Canonical: packages/shared/src/schemas/theme-contract.ts
// (legacy src/shared/schemas/theme-contract.ts)
// - Spec-verbatim: HexColorSchema / TypographyConfigSchema /
//   CompanyLogoConfigSchema / CompanyThemeConfigSchema (§3.1 Gate 1).
// - RISK_CALL notes (additive-only, documented):
//   - Hex regex fixed to /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/ (spec draft had
//     an escaped typo `\[A-F...`; semantics unchanged).
//   - Contrast engine REUSED from tenant-branding.schema.ts (single source;
//     Zero Redundant Code) — no second luminance implementation.
// - Pure helpers: CSS-var builder (Tailwind v4 token mapping), hub fallback
//   (Ahong Emerald per §2.2 THEME_ERROR), edge keys, <15ms budgets.
// - Zero new deps (zod only).
import { z } from 'zod';
import { contrastRatio, ensureReadableText } from './tenant-branding.schema';

export const HexColorSchema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, {
  message: 'Invalid Hex Color Code format',
});

export const TypographyConfigSchema = z.object({
  fontFamily: z.string().min(1),
  fontUrl: z.string().url().optional(),
  baseFontSizePx: z.number().int().min(12).max(20).default(16),
  headingWeight: z.enum(['400', '500', '600', '700', '800']).default('700'),
});
export type TypographyConfig = z.infer<typeof TypographyConfigSchema>;

export const CompanyLogoConfigSchema = z.object({
  primaryLogoUrl: z.string().url(),
  squareLogoUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
  watermarkLogoUrl: z.string().url().optional(),
  widthPx: z.number().int().positive().default(180),
  heightPx: z.number().int().positive().default(50),
});
export type CompanyLogoConfig = z.infer<typeof CompanyLogoConfigSchema>;

export const CompanyThemeConfigSchema = z.object({
  tenantId: z.string().uuid(),
  companyName: z.string().min(1),
  primaryColor: HexColorSchema,
  secondaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema.default('#FFFFFF'),
  textColor: HexColorSchema.default('#0F172A'),
  borderRadiusRem: z.number().min(0).max(2).default(0.5),
  logoConfig: CompanyLogoConfigSchema,
  typography: TypographyConfigSchema,
  isAccessibilityCompliant: z.boolean().default(true),
  updatedAt: z.string().datetime(),
});
export type CompanyThemeConfig = z.infer<typeof CompanyThemeConfigSchema>;

/** Partial admin update (§3.2 UpdateCompanyThemeInput, all-optional). */
export const UpdateCompanyThemeInputSchema = z.object({
  tenantId: z.string().uuid(),
  primaryColor: HexColorSchema.optional(),
  secondaryColor: HexColorSchema.optional(),
  accentColor: HexColorSchema.optional(),
  backgroundColor: HexColorSchema.optional(),
  textColor: HexColorSchema.optional(),
  borderRadiusRem: z.number().min(0).max(2).optional(),
  logoUrl: z.string().url().optional(),
  fontFamily: z.string().min(1).optional(),
  fontUrl: z.string().url().optional(),
});
export type UpdateCompanyThemeInput = z.infer<typeof UpdateCompanyThemeInputSchema>;

/** WCAG 2.1 AA minimum contrast for normal text (BDD Scenario 2). */
export const COMPANY_THEME_AA_MIN_RATIO = 4.5;
/** Edge resolution budget: Redis fetch <5ms, total switch <15ms (§1.1). */
export const COMPANY_THEME_EDGE_MS = 5;
export const COMPANY_THEME_SWITCH_BUDGET_MS = 15;
/** Font swap fallback: system font when the tenant font stalls (§10). */
export const COMPANY_THEME_FONT_TIMEOUT_MS = 800;
/** Company-theme edge TTL: 24h, invalidated on admin update (Gate 7). */
export const COMPANY_THEME_TTL_SEC = 86400;

/** Redis edge key for a tenant company theme (§5.2). */
export function companyThemeKey(slug: string): string {
  return `tenant:company-theme:${slug.toLowerCase()}`;
}

/** THEME_ERROR fallback: Ahong Emerald system palette (§2.2). */
export const AHONG_EMERALD_FALLBACK: CompanyThemeConfig = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  companyName: 'Ebook LIFF',
  primaryColor: '#059669',
  secondaryColor: '#10B981',
  accentColor: '#F59E0B',
  backgroundColor: '#FFFFFF',
  textColor: '#0F172A',
  borderRadiusRem: 0.5,
  logoConfig: {
    primaryLogoUrl: 'https://cdn.omnichannel.com/logo.svg',
    widthPx: 180,
    heightPx: 50,
  },
  typography: { fontFamily: 'Prompt, sans-serif', baseFontSizePx: 16, headingWeight: '700' },
  isAccessibilityCompliant: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Auto-correct text color against the background (BDD Scenario 2):
 * keeps the admin color when CR >= 4.5, else the readable extreme.
 * Returns the corrected theme (flag flips to false when corrected).
 */
export function withCompliantText(theme: CompanyThemeConfig): CompanyThemeConfig {
  if (contrastRatio(theme.backgroundColor, theme.textColor) >= COMPANY_THEME_AA_MIN_RATIO) {
    return { ...theme, isAccessibilityCompliant: true };
  }
  return {
    ...theme,
    textColor: ensureReadableText(theme.backgroundColor, theme.textColor),
    isAccessibilityCompliant: false,
  };
}

/** CSS variable map for Tailwind v4 + Shadcn (§6.2, zero-FOUC SSR inline). */
export function buildCompanyThemeCssVars(theme: CompanyThemeConfig): Record<string, string> {
  return {
    '--primary': theme.primaryColor,
    '--primary-foreground': '#FFFFFF',
    '--secondary': theme.secondaryColor,
    '--accent': theme.accentColor,
    '--background': theme.backgroundColor,
    '--foreground': theme.textColor,
    '--radius': `${theme.borderRadiusRem}rem`,
    '--font-tenant': `'${theme.typography.fontFamily}', sans-serif`,
    // 071-compat tokens (reader/canvas overlays consume these).
    '--primary-color': theme.primaryColor,
    '--secondary-color': theme.secondaryColor,
    '--accent-color': theme.accentColor,
    '--brand-logo-url': `url(${theme.logoConfig.primaryLogoUrl})`,
  };
}

/** Serialize the var map to an inline `:root` block (SSR first-ms inject). */
export function companyThemeInlineStyle(theme: CompanyThemeConfig): string {
  const vars = buildCompanyThemeCssVars(theme);
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('');
  return `:root{${body}}`;
}

/** Watermark logo for the Canvas Reader forensic overlay (§8.1 link-only). */
export function watermarkLogoFor(theme: CompanyThemeConfig): string {
  return theme.logoConfig.watermarkLogoUrl ?? theme.logoConfig.primaryLogoUrl;
}
