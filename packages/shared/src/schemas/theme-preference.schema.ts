// SSOT Phase 066 §3.1 — Theme + reading preference contracts (verbatim)
// Canonical: packages/shared/src/schemas/theme-preference.schema.ts
// (legacy src/shared/schemas/theme-preference.schema.ts)
// - Verbatim shapes from §3.1: ThemeModeEnum, ReadingFontFamilyEnum,
//   UserReadingPreferenceSchema, UpdatePreferenceInputSchema.
// - Budgets: cross-device fan-out <100ms; edge cache TTL 24h; canvas RAM
//   <30MB (CSS filter only — no canvas re-render loop); persist debounce
//   800ms; analytics via Redis Stream (circadian engine).
// - Browser-safe: pure Zod + token/filter/channel helpers. Zero new deps.
import { z } from 'zod';

export const ThemeModeEnum = z.enum(['LIGHT', 'DARK', 'SEPIA', 'OLED_BLACK', 'SYSTEM']);
export type ThemeMode = z.infer<typeof ThemeModeEnum>;

export const ReadingFontFamilyEnum = z.enum(['PROMPT', 'SARABUN', 'INTER', 'MERRIWEATHER']);
export type ReadingFontFamily = z.infer<typeof ReadingFontFamilyEnum>;

export const UserReadingPreferenceSchema = z.object({
  userId: z.string().uuid(),
  themeMode: ThemeModeEnum.default('SYSTEM'),
  fontSizePx: z.number().int().min(12).max(36).default(16),
  fontFamily: ReadingFontFamilyEnum.default('PROMPT'),
  lineHeightRatio: z.number().min(1.0).max(2.5).default(1.5),
  brightnessLevel: z.number().min(20).max(100).default(100),
  autoSyncWithSystem: z.boolean().default(true),
  updatedAt: z.string().datetime(),
});
export type UserReadingPreference = z.infer<typeof UserReadingPreferenceSchema>;

export const UpdatePreferenceInputSchema = UserReadingPreferenceSchema.omit({
  userId: true,
  updatedAt: true,
}).partial();
export type UpdatePreferenceInput = z.infer<typeof UpdatePreferenceInputSchema>;

// ---------- §5.2/§7 budgets + cache/channel/stream keys (single source) ----------
export const PREF_CACHE_TTL_SEC = 86400;
export const PREF_FANOUT_BUDGET_MS = 100;
export const PREF_PERSIST_DEBOUNCE_MS = 800;
export const PREF_ANALYTICS_STREAM = 'events:preference-changed';

export function preferenceCacheKey(userId: string): string {
  return `user:preference:${userId}`;
}

export function preferenceChannel(userId: string): string {
  return `channel:preference:${userId}`;
}

export const PREFERENCE_UPDATED_EVENT = 'preference_updated';

/** §2.1 verbatim theme tokens (Root CSS vars applied by ThemeProvider). */
export const THEME_TOKENS: Record<Exclude<ThemeMode, 'SYSTEM'>, Record<string, string>> = {
  LIGHT: {
    '--bg-primary': '#FFFFFF',
    '--text-primary': '#0F172A',
    '--canvas-bg': '#F8FAFC',
    '--canvas-filter': 'none',
  },
  DARK: {
    '--bg-primary': '#0F172A',
    '--text-primary': '#F8FAFC',
    '--canvas-bg': '#1E293B',
    '--canvas-filter': 'invert(0.9) hue-rotate(180deg)',
  },
  SEPIA: {
    '--bg-primary': '#FBF0D9',
    '--text-primary': '#5F4B32',
    '--canvas-bg': '#F4E8C1',
    '--canvas-filter': 'sepia(0.4)',
  },
  OLED_BLACK: {
    '--bg-primary': '#000000',
    '--text-primary': '#E2E8F0',
    '--canvas-bg': '#000000',
    '--canvas-filter': 'invert(1) contrast(1.2)',
  },
};

/** Resolve SYSTEM against the OS preference (client-only caller guards). */
export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): Exclude<ThemeMode, 'SYSTEM'> {
  if (mode !== 'SYSTEM') return mode;
  return prefersDark ? 'DARK' : 'LIGHT';
}

/** CSS filter applied to the reader canvas element (§6.2, zero re-render). */
export function canvasFilterFor(mode: Exclude<ThemeMode, 'SYSTEM'>): string {
  return (THEME_TOKENS[mode] ?? THEME_TOKENS.LIGHT)['--canvas-filter'] ?? 'none';
}
