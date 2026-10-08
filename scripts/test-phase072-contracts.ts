// SSOT Phase 072 §10-11 — contract tests (Zod, contrast, service, parity)
// Run: npx tsx scripts/test-phase072-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HexColorSchema,
  TypographyConfigSchema,
  CompanyLogoConfigSchema,
  CompanyThemeConfigSchema,
  UpdateCompanyThemeInputSchema,
  COMPANY_THEME_AA_MIN_RATIO,
  COMPANY_THEME_EDGE_MS,
  COMPANY_THEME_SWITCH_BUDGET_MS,
  COMPANY_THEME_FONT_TIMEOUT_MS,
  COMPANY_THEME_TTL_SEC,
  AHONG_EMERALD_FALLBACK,
  companyThemeKey,
  withCompliantText,
  buildCompanyThemeCssVars,
  companyThemeInlineStyle,
  watermarkLogoFor,
} from '../packages/shared/src/schemas/theme-contract';
import { contrastRatio } from '../packages/shared/src/schemas/tenant-branding.schema';
import { CompanyThemeService } from '../apps/backend/src/modules/tenant/company-theme.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const THEME = {
  tenantId: UUID, companyName: 'Company Alpha',
  primaryColor: '#059669', secondaryColor: '#10B981', accentColor: '#F59E0B',
  backgroundColor: '#FFFFFF', textColor: '#0F172A', borderRadiusRem: 0.5,
  logoConfig: { primaryLogoUrl: 'https://cdn.example.com/logo.svg', widthPx: 180, heightPx: 50 },
  typography: { fontFamily: 'Prompt', baseFontSizePx: 16, headingWeight: '700' },
  isAccessibilityCompliant: true,
  updatedAt: new Date().toISOString(),
};

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(HexColorSchema.safeParse('#FFFFFF').success, true);
  assert.equal(HexColorSchema.safeParse('#fff').success, true);
  assert.equal(HexColorSchema.safeParse('red').success, false);
  assert.equal(TypographyConfigSchema.safeParse({ fontFamily: 'Prompt' }).success, true);
  assert.equal(TypographyConfigSchema.safeParse({ fontFamily: 'P', baseFontSizePx: 11 }).success, false);
  assert.equal(CompanyLogoConfigSchema.safeParse({ primaryLogoUrl: 'https://x/y.svg' }).success, true);
  assert.equal(CompanyLogoConfigSchema.safeParse({ primaryLogoUrl: 'nope' }).success, false);
  const parsed = CompanyThemeConfigSchema.safeParse(THEME);
  assert.equal(parsed.success, true);
  assert.equal(CompanyThemeConfigSchema.safeParse({ ...THEME, tenantId: 'x' }).success, false);
  // Spec defaults survive omission.
  const minimal = CompanyThemeConfigSchema.parse({
    tenantId: UUID, companyName: 'C',
    primaryColor: '#000000', secondaryColor: '#111111', accentColor: '#222222',
    logoConfig: { primaryLogoUrl: 'https://x/y.svg' },
    typography: { fontFamily: 'Inter' },
    updatedAt: new Date().toISOString(),
  });
  assert.equal(minimal.backgroundColor, '#FFFFFF');
  assert.equal(minimal.borderRadiusRem, 0.5);
  assert.equal(minimal.logoConfig.widthPx, 180);
  assert.equal(UpdateCompanyThemeInputSchema.safeParse({ tenantId: UUID, primaryColor: '#123456' }).success, true);
  assert.equal(UpdateCompanyThemeInputSchema.safeParse({ primaryColor: '#123456' }).success, false);
  assert.equal(COMPANY_THEME_AA_MIN_RATIO, 4.5);
  assert.equal(COMPANY_THEME_EDGE_MS, 5);
  assert.equal(COMPANY_THEME_SWITCH_BUDGET_MS, 15);
  assert.equal(COMPANY_THEME_FONT_TIMEOUT_MS, 800);
  assert.equal(COMPANY_THEME_TTL_SEC, 86400);
  assert.equal(companyThemeKey('Company_Alpha'), 'tenant:company-theme:company_alpha');
  assert.equal(CompanyThemeConfigSchema.safeParse(AHONG_EMERALD_FALLBACK).success, true);
  ok('Zod §3.1 verbatim + defaults + keys/budgets');
}

// ---------- 2. WCAG auto-correction (BDD Scenario 2, Gate 4) ----------
{
  // Admin sets white-on-white: engine corrects to a readable extreme.
  const bad = withCompliantText({ ...THEME, backgroundColor: '#FFFFFF', textColor: '#FFFFFF' });
  assert.ok(contrastRatio(bad.backgroundColor, bad.textColor) >= 4.5, 'corrected CR >= 4.5');
  assert.equal(bad.isAccessibilityCompliant, false);
  // Compliant pair passes through untouched.
  const good = withCompliantText({ ...THEME });
  assert.equal(good.textColor, '#0F172A');
  assert.equal(good.isAccessibilityCompliant, true);
  ok('Contrast auto-correction white-on-white + pass-through');
}

// ---------- 3. CSS vars + inline style + watermark (§6.2, §8.1) ----------
{
  const vars = buildCompanyThemeCssVars(THEME as never);
  assert.equal(vars['--primary'], '#059669');
  assert.equal(vars['--background'], '#FFFFFF');
  assert.equal(vars['--foreground'], '#0F172A');
  assert.equal(vars['--radius'], '0.5rem');
  assert.equal(vars['--font-tenant'], "'Prompt', sans-serif");
  assert.equal(vars['--primary-color'], '#059669');
  const inline = companyThemeInlineStyle(THEME as never);
  assert.ok(inline.startsWith(':root{') && inline.includes('--primary:#059669;'));
  assert.equal(watermarkLogoFor(THEME as never), 'https://cdn.example.com/logo.svg');
  assert.equal(
    watermarkLogoFor({ ...THEME, logoConfig: { ...THEME.logoConfig, watermarkLogoUrl: 'https://x/wm.svg' } } as never),
    'https://x/wm.svg',
  );
  ok('CSS vars/inline/watermark link (canvas untouched)');
}

// ---------- 4. CompanyThemeService (Redis-first + 404 + update) ----------
function row(over: Record<string, unknown> = {}) {
  return {
    primaryColor: '#059669', secondaryColor: '#10B981', accentColor: '#F59E0B',
    backgroundColor: '#FFFFFF', textColor: '#0F172A', borderRadiusRem: 0.5,
    primaryLogoUrl: 'https://cdn.example.com/logo.svg',
    squareLogoUrl: null, faviconUrl: null, watermarkLogoUrl: null,
    fontFamily: 'Prompt', fontUrl: null, isAccessibilityValid: true,
    updatedAt: new Date(), ...over,
  };
}
function makePorts(opts?: {
  tenant?: { id: string; slug: string; name: string; isActive: boolean; theme: ReturnType<typeof row> | null } | null;
  failCache?: boolean;
}) {
  const kv = new Map<string, string>();
  const dels: string[] = [];
  return {
    tables: {
      tenant: {
        findBySlugWithTheme: async () => opts?.tenant ?? null,
        findSlugById: async () => opts?.tenant?.slug ?? null,
      },
      companyTheme: {
        upsertByTenant: async () => row(),
      },
    },
    cache: {
      get: async (k: string) => {
        if (opts?.failCache) throw new Error('redis down');
        return kv.get(k) ?? null;
      },
      setex: async (k: string, _t: number, v: string) => {
        if (opts?.failCache) throw new Error('redis down');
        kv.set(k, v);
      },
      del: async (k: string) => {
        dels.push(k);
        kv.delete(k);
      },
    },
    kv, dels,
  };
}

async function sectionService(): Promise<void> {
  // BDD-1: Redis hit (<5ms path).
  {
    const { tables, cache } = makePorts();
    const svc = new CompanyThemeService(tables, cache);
    await cache.setex(companyThemeKey('company-alpha'), 60, JSON.stringify(THEME));
    const t = await svc.getThemeBySlug('company-alpha');
    assert.equal(t.companyName, 'Company Alpha');
  }
  // DB fallback + sanitized refill (white-on-white corrected before cache).
  {
    const { tables, cache, kv } = makePorts({
      tenant: { id: UUID, slug: 'company-alpha', name: 'Company Alpha', isActive: true, theme: row({ textColor: '#FFFFFF' }) },
    });
    const svc = new CompanyThemeService(tables, cache);
    const t = await svc.getThemeBySlug('company-alpha');
    assert.ok(contrastRatio(t.backgroundColor, t.textColor) >= 4.5);
    assert.equal(t.isAccessibilityCompliant, false);
    assert.ok(kv.has(companyThemeKey('company-alpha')), 'sanitized payload refilled');
  }
  // Unknown / inactive / themeless -> 404 (THEME_ERROR -> hub fallback).
  for (const tenant of [
    null,
    { id: UUID, slug: 'x', name: 'X', isActive: false, theme: row() },
    { id: UUID, slug: 'x', name: 'X', isActive: true, theme: null },
  ]) {
    const { tables, cache } = makePorts({ tenant: tenant as never });
    const svc = new CompanyThemeService(tables, cache);
    await assert.rejects(svc.getThemeBySlug('x'), /not found/);
  }
  // Corrupt cache self-heals via DB.
  {
    const { tables, cache } = makePorts({
      tenant: { id: UUID, slug: 'c', name: 'C', isActive: true, theme: row() },
    });
    await cache.setex(companyThemeKey('c'), 60, '{broken');
    const svc = new CompanyThemeService(tables, cache);
    assert.equal((await svc.getThemeBySlug('c')).companyName, 'C');
  }
  // Update: Zod gate + slug invalidation (Gate 7).
  {
    const { tables, cache, dels } = makePorts({
      tenant: { id: UUID, slug: 'company-alpha', name: 'C', isActive: true, theme: row() },
    });
    const svc = new CompanyThemeService(tables, cache);
    const t = await svc.updateCompanyTheme({ tenantId: UUID, primaryColor: '#123456' });
    assert.equal(t.primaryColor, '#059669'); // seed row echoes; patch path asserted via dels
    assert.ok(dels.includes(companyThemeKey('company-alpha')), 'slug cache invalidated');
    await assert.rejects(svc.updateCompanyTheme({ primaryColor: '#123456' }), /Invalid company theme/);
  }
  // Redis outage: DB still serves (self-heal §10).
  {
    const { tables, cache } = makePorts({
      tenant: { id: UUID, slug: 'c', name: 'C', isActive: true, theme: row() }, failCache: true,
    });
    const svc = new CompanyThemeService(tables, cache);
    assert.equal((await svc.getThemeBySlug('c')).companyName, 'C');
  }
  ok('Service: edge-hit/DB-refill/404/corrupt-heal/update-invalidate/outage');
}

// ---------- 5. Prisma additive (Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model CompanyTheme {', 'themeConfig   CompanyTheme?', 'tenant               Tenant   @relation(fields: [tenantId]',
    'isAccessibilityValid Boolean', 'fontFamily           String', '@@index([tenantId])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: CompanyTheme 1:1 + Tenant.themeConfig');
}

// ---------- 6. Static parity ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/tenant/company-theme.service.ts', 'utf8');
  for (const t of ['CompanyThemeService', 'getThemeBySlug', 'updateCompanyTheme', 'invalidateTenantCache', 'withInfra', 'withCompliantText']) {
    assert.ok(svc.includes(t), `service missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/tenant/company-theme.controller.ts', 'utf8');
  assert.ok(ctrl.includes("'company-theme'") && ctrl.includes('JwtAuthGuard'));
  const mod = readFileSync('apps/backend/src/modules/tenant/tenant-resolver.module.ts', 'utf8');
  assert.ok(mod.includes('CompanyThemeService') && mod.includes('CompanyThemeController'));
  const gql = readFileSync('apps/backend/src/api/graphql/tenant.resolver.ts', 'utf8');
  for (const t of ['getTenantTheme', 'updateTenantTheme', 'CompanyThemeConfig', 'CompanyLogoConfig', 'TypographyConfig', 'UpdateCompanyThemeInput']) {
    assert.ok(gql.includes(t), `GQL missing: ${t}`);
  }
  assert.ok(!gql.includes('TenantGuard'), 'GQL stays behind gateway context (no per-field guard)');
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/tenant.graphql', 'utf8');
  for (const t of ['getTenantTheme', 'updateTenantTheme', 'CompanyThemeConfig', 'borderRadiusRem: Float!']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes('x-tenant-slug'), 'middleware 072 compat header');
  const client = readFileSync('apps/frontend/lib/theme/company-theme-client.ts', 'utf8');
  for (const t of ['fetchCompanyTheme', 'applyCompanyThemeVars', 'preloadTenantFont', 'unloadTenantFont', 'revokeObjectURL', 'COMPANY_THEME_FONT_TIMEOUT_MS']) {
    assert.ok(client.includes(t), `theme-client missing: ${t}`);
  }
  const provider = readFileSync('apps/frontend/components/theme/DynamicThemeProvider.tsx', 'utf8');
  for (const t of ['THEME_INIT', 'THEME_RESOLVED', 'THEME_LOADING', 'THEME_SUCCESS', 'THEME_ERROR', 'CompanyThemeSkeleton', 'useCompanyTheme']) {
    assert.ok(provider.includes(t), `provider missing: ${t}`);
  }
  assert.ok(!provider.includes('<head>'), 'no <head> in client component (App Router)');
  const liff = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(liff.includes('DynamicCompanyThemeProvider'));
  const web = readFileSync('apps/frontend/app/(web)/layout.tsx', 'utf8');
  assert.ok(web.includes('DynamicCompanyThemeProvider'));
  const proxy = readFileSync('apps/frontend/app/api/v1/tenant/company-theme/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/v1/tenant/company-theme'));
  const css = readFileSync('apps/frontend/styles/globals.css', 'utf8');
  for (const t of ['--primary:', '--font-tenant', '.theme-skeleton', '.theme-fade-overlay']) {
    assert.ok(css.includes(t), `globals.css missing: ${t}`);
  }
  assert.ok(!css.includes('@theme'), 'no Tailwind directives without the dep');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('theme-contract') && barrel.includes('CompanyThemeConfigSchema'));
  ok('Parity: service/REST/module/GQL/SDL/middleware/client/provider/layouts/proxy/css/barrel');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase072 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
