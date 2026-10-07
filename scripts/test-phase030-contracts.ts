// SSOT Phase 030 §10 — contract tests (Zod, contrast, cache, repo, service, UI)
// Run: npx tsx scripts/test-phase030-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NavigationBarIconThemeEnum,
  TenantBrandingSchema,
  UpdateNavbarThemeInputSchema,
  tenantThemeKey,
  TENANT_THEME_TTL_SEC,
  THEME_ANALYTICS_CHANNEL,
  WCAG_AA_MIN_RATIO,
  relativeLuminance,
  contrastRatio,
  ensureReadableText,
  resolveIconTheme,
} from '../packages/shared/src/schemas/tenant-branding.schema';
import { ThemeColor } from '../apps/backend/src/modules/tenant/domain/value-objects/theme-color.vo';
import { ContrastCalculatorService } from '../apps/backend/src/modules/tenant/domain/services/contrast-calculator.service';
import { TenantThemeCache } from '../apps/backend/src/modules/tenant/infrastructure/cache/tenant-redis.cache';
import { TenantPrismaRepository } from '../apps/backend/src/modules/tenant/infrastructure/persistence/tenant-prisma.repository';
import { TenantThemeService } from '../apps/backend/src/modules/tenant/tenant-theme.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import { applyThemeVars } from '../apps/frontend/hooks/useLiffTheme';
import { themeCacheKey, isThemeFresh, THEME_TTL_MS } from '../apps/frontend/lib/theme/theme-cache';
// NOTE: TenantThemeResolver/Controller use Nest parameter decorators
// (@Args/@Body) which tsx/esbuild cannot transform — verified via static
// source parity (§9) following the Phase 027–029 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const BRANDING = {
  tenantId: 'company-a',
  brandName: 'Company A',
  logoUrl: 'https://cdn.omnichannel.com/logo-a.png',
  primaryColor: '#10B981',
  navBarBgColor: '#0F172A',
  navBarTextColor: '#FFFFFF',
  iconTheme: 'AUTO',
  enableCustomCloseButton: true,
  enableShareOptionMenu: true,
  updatedAt: new Date().toISOString(),
};

// ---------- 1. Zod branding/input boundaries (§3.1 Gate 1/4) ----------
{
  for (const t of ['LIGHT', 'DARK', 'AUTO']) assert.equal(NavigationBarIconThemeEnum.safeParse(t).success, true);
  assert.equal(TenantBrandingSchema.safeParse(BRANDING).success, true);
  const noLogo = { ...BRANDING };
  delete (noLogo as Partial<typeof noLogo>).logoUrl;
  assert.equal(TenantBrandingSchema.safeParse(noLogo).success, true);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, navBarBgColor: 'red' }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, primaryColor: '#10B98G' }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, primaryColor: 'javascript:alert(1)' }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, logoUrl: 'not-a-url' }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, brandName: 'x'.repeat(101) }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, tenantId: '' }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...BRANDING, primaryColor: '#abc' }).success, true);
  const input = {
    tenantId: 'company-a', primaryColor: '#10B981', navBarBgColor: '#0F172A',
    navBarTextColor: '#FFFFFF', iconTheme: 'DARK', enableCustomCloseButton: false, enableShareOptionMenu: true,
  };
  assert.equal(UpdateNavbarThemeInputSchema.safeParse(input).success, true);
  assert.equal(UpdateNavbarThemeInputSchema.safeParse({ ...input, navBarBgColor: '#zzz' }).success, false);
  assert.equal(tenantThemeKey('company-a'), 'tenant:theme:company-a');
  assert.equal(TENANT_THEME_TTL_SEC, 86400);
  assert.equal(THEME_ANALYTICS_CHANNEL, 'tenant.theme.applied');
  assert.equal(WCAG_AA_MIN_RATIO, 4.5);
  ok('Zod icon enum + branding/input hex/logo/name guards + key/TTL/channel');
}

// ---------- 2. WCAG contrast engine (BDD Scenario 2) ----------
{
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#0F172A', '#0F172A'), 1);
  assert.ok(contrastRatio('#0F172A', '#FFFFFF') >= 4.5);
  assert.ok(contrastRatio('#EEEEEE', '#FFFFFF') < 4.5);
  // Passing preference is kept (normalized).
  assert.equal(ensureReadableText('#0F172A', '#ffffff'), '#FFFFFF');
  // Failing preference flips to the readable extreme.
  assert.equal(ensureReadableText('#EEEEEE', '#FFFFFF'), '#000000');
  assert.equal(ensureReadableText('#111111', '#222222'), '#FFFFFF');
  assert.equal(resolveIconTheme('LIGHT', '#FFFFFF'), 'LIGHT');
  assert.equal(resolveIconTheme('DARK', '#000000'), 'DARK');
  assert.equal(resolveIconTheme('AUTO', '#0F172A'), 'LIGHT');
  assert.equal(resolveIconTheme('AUTO', '#FFFFFF'), 'DARK');
  ok('Luminance/ratio anchors + AA keep/flip + AUTO icon resolution');
}

// ---------- 3. ThemeColor VO (Gate 4 sanitization) ----------
{
  assert.equal(ThemeColor.of('#abc').hex, '#AABBCC');
  assert.equal(ThemeColor.of('#0f172a').hex, '#0F172A');
  assert.throws(() => ThemeColor.of('red'), /Invalid Hex Color/);
  assert.throws(() => ThemeColor.of('#10B98G'), /Invalid Hex Color/);
  assert.throws(() => ThemeColor.of('expression(alert(1))'), /Invalid Hex Color/);
  assert.equal(ThemeColor.of('#000000').luminance(), 0);
  assert.equal(ThemeColor.of('#000000').contrastAgainst(ThemeColor.of('#FFFFFF')), 21);
  ok('VO normalizes + rejects injection + exposes luminance/contrast');
}

// ---------- 4. ContrastCalculator verdicts ----------
{
  const calc = new ContrastCalculatorService();
  const pass = calc.check('#0F172A', '#FFFFFF', 'AUTO');
  assert.equal(pass.passesAA, true);
  assert.equal(pass.textColor, '#FFFFFF');
  assert.equal(pass.iconTheme, 'LIGHT');
  assert.ok(pass.ratio >= 4.5);
  const fail = calc.check('#EEEEEE', '#FFFFFF', 'AUTO');
  assert.equal(fail.passesAA, false);
  assert.equal(fail.textColor, '#000000');
  assert.equal(fail.iconTheme, 'DARK');
  const explicit = calc.check('#0F172A', '#FFFFFF', 'DARK');
  assert.equal(explicit.iconTheme, 'DARK');
  assert.equal(calc.ratioOf('#000000', '#FFFFFF'), 21);
  assert.throws(() => calc.check('nope', '#FFFFFF', 'AUTO'), /Invalid Hex Color/);
  ok('Calculator verdict ratio/AA/text/icon + explicit theme + bad-hex throws');
}

function stubCluster(store: Map<string, string> = new Map(), published: Array<{ c: string; m: string }> = []): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService;
}

const ROW = {
  tenantSlug: 'company-a',
  defaultTitle: 'Company A',
  logoUrl: 'https://cdn.omnichannel.com/logo-a.png',
  primaryColor: '#10B981',
  navBarBgColor: '#0F172A',
  navBarTextColor: '#FFFFFF',
  iconTheme: 'AUTO',
  enableCustomCloseButton: true,
  enableShareOptionMenu: true,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function serviceWith(over: { row?: typeof ROW | null; cached?: string | null; upserted?: unknown[]; published?: Array<{ c: string; m: string }> }) {
  const store = new Map<string, string>();
  if (over.cached !== undefined && over.cached !== null) store.set('tenant:theme:company-a', over.cached);
  const published = over.published ?? [];
  const upserted = over.upserted ?? [];
  const redis = stubCluster(store, published);
  const prisma = {
    tenantBranding: {
      findUnique: async () => over.row ?? null,
      upsert: async (args: unknown) => { upserted.push(args); return { ...(over.row ?? ROW), updatedAt: new Date() }; },
    },
  } as unknown as PrismaService;
  const svc = new TenantThemeService(
    new TenantPrismaRepository(prisma),
    new TenantThemeCache(redis),
    new ContrastCalculatorService(),
    redis,
  );
  return { svc, store, published, upserted };
}

async function main(): Promise<void> {
// ---------- 5. Theme cache: key/TTL/ops + fail-open ----------
{
  const cache = new TenantThemeCache(stubCluster(new Map([['tenant:theme:a', '{"x":1}']])));
  assert.equal(cache.key('a'), 'tenant:theme:a');
  assert.equal(await cache.get('a'), '{"x":1}');
  assert.equal(await cache.get('missing'), null);
  await cache.set('b', '{}');
  assert.equal(await cache.get('b'), '{}');
  await cache.del('b');
  assert.equal(await cache.get('b'), null);
  const dead = new TenantThemeCache({
    get: async () => { throw new Error('down'); },
    setex: async () => { throw new Error('down'); },
    del: async () => { throw new Error('down'); },
  } as unknown as RedisClusterService);
  assert.equal(await dead.get('a'), null);
  await dead.set('a', '{}');
  await dead.del('a');
  ok('Cache key/CRUD round-trip + outage fail-open');
}

// ---------- 6. Repository: slug read + atomic upsert shape ----------
{
  const found: unknown[] = [];
  const upserted: unknown[] = [];
  const repo = new TenantPrismaRepository({
    tenantBranding: {
      findUnique: async (a: unknown) => { found.push(a); return ROW; },
      upsert: async (a: unknown) => { upserted.push(a); return ROW; },
    },
  } as unknown as PrismaService);
  assert.deepEqual(await repo.findBySlug('company-a'), ROW);
  assert.deepEqual(found[0], { where: { tenantSlug: 'company-a' } });
  const { updatedAt: _drop, ...noDate } = ROW;
  await repo.upsertBySlug(noDate);
  assert.deepEqual((upserted[0] as { where: unknown }).where, { tenantSlug: 'company-a' });
  // Update path must NOT touch title/logo (branding-owner columns).
  const updateData = (upserted[0] as { update: Record<string, unknown> }).update;
  assert.ok(!('defaultTitle' in updateData) && !('logoUrl' in updateData) && !('tenantSlug' in updateData));
  assert.equal(updateData.navBarBgColor, '#0F172A');
  const down = new TenantPrismaRepository({
    tenantBranding: { findUnique: async () => { throw new Error('down'); }, upsert: async () => { throw new Error('down'); } },
  } as unknown as PrismaService);
  assert.equal(await down.findBySlug('x'), null);
  await assert.rejects(() => down.upsertBySlug(noDate), /down/);
  ok('Repo slug read + upsert where-shape; read fail-open, write surfaces');
}

// ---------- 7. Service: edge hit / refill / 404 + guarded update path ----------
{
  // Edge hit: served + text guarded, no DB touch.
  const hit = serviceWith({ cached: JSON.stringify(BRANDING) });
  const branded = await hit.svc.getTenantBranding('company-a');
  assert.equal(branded.brandName, 'Company A');
  assert.equal(branded.navBarTextColor, '#FFFFFF');

  // Edge hit with failing text: auto-flipped before serving.
  const flipped = serviceWith({ cached: JSON.stringify({ ...BRANDING, navBarBgColor: '#EEEEEE', navBarTextColor: '#FFFFFF' }) });
  assert.equal((await flipped.svc.getTenantBranding('company-a')).navBarTextColor, '#000000');

  // Corrupt edge → DB refill + re-cache.
  const refill = serviceWith({ cached: 'corrupt{{{', row: ROW });
  const refilled = await refill.svc.getTenantBranding('company-a');
  assert.equal(refilled.tenantId, 'company-a');
  assert.ok((refill.store.get('tenant:theme:company-a') ?? '').includes('Company A'));

  // Unknown slug → 404; empty slug → 400.
  const miss = serviceWith({ row: null });
  await assert.rejects(() => miss.svc.getTenantBranding('ghost'), /not found/);
  await assert.rejects(() => miss.svc.getTenantBranding(''), /Missing tenant slug/);

  // Update: guarded text persisted, cache invalidated, event published.
  const published: Array<{ c: string; m: string }> = [];
  const upserted: unknown[] = [];
  const upd = serviceWith({ row: ROW, published, upserted });
  upd.store.set('tenant:theme:company-a', 'stale');
  assert.equal(await upd.svc.updateNavbarTheme({
    tenantId: 'company-a', primaryColor: '#10B981', navBarBgColor: '#EEEEEE',
    navBarTextColor: '#FFFFFF', iconTheme: 'AUTO', enableCustomCloseButton: true, enableShareOptionMenu: false,
  }), true);
  const data = (upserted[0] as { update: Record<string, unknown> }).update;
  assert.equal(data.navBarTextColor, '#000000');
  assert.equal(data.iconTheme, 'DARK');
  assert.equal(upd.store.has('tenant:theme:company-a'), false);
  assert.equal(published[0].c, 'tenant.theme.applied');
  assert.ok((published[0] as { m: string }).m.includes('navbar_theme_applied'));
  await assert.rejects(() => upd.svc.updateNavbarTheme({ tenantId: 'x', primaryColor: 'red', navBarBgColor: '#000', navBarTextColor: '#fff', iconTheme: 'AUTO', enableCustomCloseButton: true, enableShareOptionMenu: true }), /Invalid navbar theme/);
  ok('Service edge-first + corrupt refill + 404/400; update guards text, invalidates, publishes');
}

// ---------- 8. Frontend pure units: theme vars + cache key/TTL ----------
{
  const set: Array<[string, string]> = [];
  applyThemeVars({ ...BRANDING, iconTheme: 'AUTO' }, { style: { setProperty: (k: string, v: string) => { set.push([k, v]); } } });
  const vars = Object.fromEntries(set);
  assert.equal(vars['--primary-color'], '#10B981');
  assert.equal(vars['--nav-bg'], '#0F172A');
  assert.equal(vars['--nav-text'], '#FFFFFF');
  assert.equal(vars['--nav-bg-color'], '#0F172A');
  assert.equal(vars['--nav-text-color'], '#FFFFFF');

  assert.equal(themeCacheKey('company-a'), 'theme:company-a');
  assert.equal(THEME_TTL_MS, 86400000);
  assert.equal(isThemeFresh(Date.now() - 1000), true);
  assert.equal(isThemeFresh(Date.now() - THEME_TTL_MS - 1), false);

  const hook = readFileSync('apps/frontend/hooks/useLiffTheme.ts', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) assert.ok(hook.includes(s), `hook missing ${s}`);
  for (const t of ['setNavigationBarColor', 'applyThemeVars', 'getLiff']) assert.ok(hook.includes(t), `hook missing ${t}`);
  assert.ok(!hook.includes("from '@line/liff'"), 'RAM guard: no static SDK import');
  ok('Theme vars injection + cache TTL + hook 5-state/native markers');
}

// ---------- 9. Wiring + SDL + provider/customizer/layout/middleware/proxy ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['navBarBgColor', 'navBarTextColor', 'iconTheme', 'enableCustomCloseButton', 'enableShareOptionMenu', '@@index([tenantSlug])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/tenant-theme.graphql/schema.graphql', 'utf8');
  for (const t of ['TenantBranding', 'UpdateNavbarThemeInput', 'tenantBranding', 'updateNavbarTheme']) {
    assert.ok(sdl.includes(t), `SDL missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/tenant/tenant-theme.module.ts', 'utf8');
  for (const t of ['TenantThemeService', 'TenantThemeResolver', 'TenantThemeController', 'ContrastCalculatorService', 'TenantThemeCache', 'TenantPrismaRepository']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('TenantThemeModule'));
  const resolverSrc = readFileSync('apps/backend/src/modules/tenant/tenant-theme.resolver.ts', 'utf8');
  for (const t of ['tenantBranding', 'updateNavbarTheme', 'Missing tenant slug', 'TenantThemeService', 'TenantBrandingGql', 'UpdateNavbarThemeInputGql']) {
    assert.ok(resolverSrc.includes(t), `resolver missing ${t}`);
  }
  const ctlSrc = readFileSync('apps/backend/src/modules/tenant/tenant-theme.controller.ts', 'utf8');
  for (const t of ['api/v1/tenant', "'theme'", 'JwtAuthGuard', '@Put', '@Get']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  const dtoSrc = readFileSync('apps/backend/src/modules/tenant/dto/tenant-branding.dto.ts', 'utf8');
  assert.ok(dtoSrc.includes("from '@repo/shared'") && dtoSrc.includes('TenantBrandingSchema'));

  const provider = readFileSync('apps/frontend/providers/TenantThemeProvider.tsx', 'utf8');
  for (const t of ['useLiffTheme', 'readCachedTheme', 'writeCachedTheme', '/api/v1/tenant/theme', 'TenantBrandingSchema', 'createContext']) {
    assert.ok(provider.includes(t), `provider missing ${t}`);
  }
  const customizer = readFileSync('apps/frontend/components/liff/LiffNavbarCustomizer.tsx', 'utf8');
  for (const t of ['liff-navbar', 'var(--nav-bg-color)', 'var(--nav-text-color)', 'aria-label="Close"', 'aria-label="Options"', 'closeWindow', 'enableCustomCloseButton', 'enableShareOptionMenu']) {
    assert.ok(customizer.includes(t), `customizer missing ${t}`);
  }
  assert.ok(!customizer.includes("from 'lucide") && !customizer.includes('from "lucide'), 'zero new deps: no lucide import');
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('TenantThemeProvider'));
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/api/v1/tenant/theme'"));
  const proxy = readFileSync('apps/frontend/app/api/v1/tenant/theme/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/v1/tenant/theme') && proxy.includes('Missing tenant slug'));
  ok('Prisma/SDL/module wired; resolver/controller/DTO parity; provider/customizer/layout/middleware/proxy');
}

console.log(`\nPhase 030 contracts: ${passed} checks passed`);
}

void main();
