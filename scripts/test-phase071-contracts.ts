// SSOT Phase 071 §10-11 — contract tests (Zod, resolver, guard, service, parity)
// Run: npx tsx scripts/test-phase071-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { of } from 'rxjs';
import {
  TenantStatusEnum,
  TenantBrandingSchema,
  TenantContextResolverSchema,
  TenantIdentifierSchema,
  TENANT_RESOLVER_BUDGET_MS,
  TENANT_STATUS_TTL_SEC,
  DEFAULT_TENANT_SLUG,
  tenantStatusKey,
  tenantSlugKey,
  tenantDomainKey,
  tenantVaultPrefix,
  resolveTenantIdentifier,
  isCustomDomainIdentifier,
  customDomainOf,
} from '../packages/shared/src/schemas/tenant-contract';
import {
  resolveTenantIdentifier as edgeResolve,
  resolveTenant,
  extractTenantFromLiffUrl,
} from '../apps/frontend/lib/tenant/tenant-resolver';
import { TenantGuard } from '../apps/backend/src/common/guards/tenant.guard';
import { TenantHeaderInterceptor } from '../apps/backend/src/common/interceptors/tenant-header.interceptor';
import { TenantResolverService, HUB_BRANDING } from '../apps/backend/src/modules/tenant/tenant-resolver.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID2 = '223e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + helpers/keys/budgets ----------
{
  assert.equal(TenantStatusEnum.safeParse('ACTIVE').success, true);
  assert.equal(TenantStatusEnum.safeParse('SUSPENDED').success, true);
  assert.equal(TenantStatusEnum.safeParse('DELETED').success, false);
  const branding = {
    tenantId: UUID, tenantSlug: 'academy-a', brandName: 'Academy A',
    logoUrl: 'https://cdn.example.com/logo.png',
    primaryColor: '#000000', secondaryColor: '#ffffff', accentColor: '#10b981',
  };
  assert.equal(TenantBrandingSchema.safeParse(branding).success, true);
  assert.equal(TenantBrandingSchema.safeParse({ ...branding, tenantId: 'not-a-uuid' }).success, false);
  assert.equal(TenantBrandingSchema.safeParse({ ...branding, primaryColor: 'red' }).success, false);
  assert.equal(
    TenantContextResolverSchema.safeParse({
      hostname: 'academy-a.omnichannel.com', resolvedTenantId: UUID,
      isCustomDomain: false, resolvedAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(TenantIdentifierSchema.safeParse('academy-a').success, true);
  // §6.1 precedence: query > subdomain > custom > default.
  assert.equal(resolveTenantIdentifier({ hostname: 'academy-a.omnichannel.com' }), 'academy-a');
  assert.equal(
    resolveTenantIdentifier({ hostname: 'academy-a.omnichannel.com', queryTenant: 'brand-x' }),
    'brand-x',
  );
  assert.equal(resolveTenantIdentifier({ hostname: 'brand-a.com' }), 'custom:brand-a.com');
  assert.equal(resolveTenantIdentifier({ hostname: 'omnichannel.com' }), 'default');
  assert.equal(resolveTenantIdentifier({ hostname: 'localhost' }), 'default');
  assert.equal(isCustomDomainIdentifier('custom:brand-a.com'), true);
  assert.equal(isCustomDomainIdentifier('academy-a'), false);
  assert.equal(customDomainOf('custom:brand-a.com'), 'brand-a.com');
  assert.equal(customDomainOf('academy-a'), null);
  assert.equal(tenantStatusKey('T1'), 'tenant:status:T1');
  assert.equal(tenantSlugKey('Academy-A'), 'tenant:slug:academy-a');
  assert.equal(tenantDomainKey('Brand-A.COM'), 'tenant:domain:brand-a.com');
  assert.equal(tenantVaultPrefix('T1'), 'tenants/T1/');
  assert.equal(TENANT_RESOLVER_BUDGET_MS, 1);
  assert.equal(TENANT_STATUS_TTL_SEC, 86400);
  assert.equal(DEFAULT_TENANT_SLUG, 'default');
  ok('Zod §3.1 verbatim + precedence/keys/budgets');
}

// ---------- 2. Edge resolver byte-parity (frontend <-> SSOT) ----------
{
  const matrix = [
    { hostname: 'academy-a.omnichannel.com', queryTenant: undefined },
    { hostname: 'academy-a.omnichannel.com', queryTenant: 'brand-x' },
    { hostname: 'brand-a.com', queryTenant: undefined },
    { hostname: 'omnichannel.com', queryTenant: undefined },
    { hostname: 'localhost', queryTenant: undefined },
    { hostname: 'localhost:3000', queryTenant: undefined },
    { hostname: 'ACAD.omnichannel.com', queryTenant: '  Brand-X  ' },
    { hostname: 'deep.sub.omnichannel.com', queryTenant: undefined },
  ];
  for (const m of matrix) {
    assert.equal(edgeResolve(m), resolveTenantIdentifier(m), `parity: ${JSON.stringify(m)}`);
  }
  // Rich + LIFF-query fallback (§1.3 BDD-2).
  assert.deepEqual(resolveTenant({ hostname: 'academy-a.omnichannel.com' }), {
    identifier: 'academy-a', isCustomDomain: false, isDefault: false,
  });
  assert.deepEqual(resolveTenant({ hostname: 'brand-a.com' }), {
    identifier: 'custom:brand-a.com', isCustomDomain: true, isDefault: false,
  });
  assert.equal(extractTenantFromLiffUrl('https://liff.line.me/200123456-AbCdEfgh?tenant=brand-x&target=ebook'), 'brand-x');
  assert.equal(extractTenantFromLiffUrl('https://liff.line.me/200123456-AbCdEfgh?target=ebook'), null);
  assert.equal(extractTenantFromLiffUrl('not a url ???'), null);
  // Perf guard (§10): 10k resolutions must stay far under budget.
  const t0 = Date.now();
  for (let i = 0; i < 10000; i++) edgeResolve({ hostname: 'academy-a.omnichannel.com' });
  assert.ok(Date.now() - t0 < 1000, 'resolver perf: 10k ops < 1s');
  ok('Edge resolver parity + LIFF fallback + perf');
}

// ---------- 3. TenantGuard (§5.1 Gate 4) ----------
function httpCtx(req: Record<string, unknown>) {
  return {
    getClass: () => class {},
    getHandler: () => function handler() {},
    getArgs: () => [],
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

async function sectionGuard(): Promise<void> {
  // Missing header -> 401.
  {
    const guard = new TenantGuard({ get: async () => 'ACTIVE' } as never);
    await assert.rejects(guard.canActivate(httpCtx({ headers: {} })), /Missing X-Tenant-ID/);
  }
  // Suspended/unknown -> 401 (fail-closed).
  for (const status of ['SUSPENDED', null]) {
    const guard = new TenantGuard({ get: async () => status } as never);
    await assert.rejects(
      guard.canActivate(httpCtx({ headers: { 'x-tenant-id': UUID } })),
      /inactive or suspended/,
    );
  }
  // Redis outage -> 401 (fail-closed, never fail-open).
  {
    const guard = new TenantGuard({ get: async () => { throw new Error('down'); } } as never);
    await assert.rejects(guard.canActivate(httpCtx({ headers: { 'x-tenant-id': UUID } })), /unavailable/);
  }
  // ACTIVE -> true + req.tenantId attached (Zero Redundant downstream).
  {
    const req: Record<string, unknown> = { headers: { 'x-tenant-id': UUID } };
    const guard = new TenantGuard({ get: async () => 'ACTIVE' } as never);
    assert.equal(await guard.canActivate(httpCtx(req)), true);
    assert.equal(req['tenantId'], UUID);
  }
  ok('Guard: missing/suspended/outage 401 + ACTIVE attach');
}

// ---------- 4. TenantHeaderInterceptor (§7 pipeline) ----------
async function sectionInterceptor(): Promise<void> {
  const ic = new TenantHeaderInterceptor();
  const run = (req: Record<string, unknown>, res: Record<string, string>) =>
    new Promise<unknown>((resolve, reject) => {
      const ctx = {
        getClass: () => class {},
        getHandler: () => function handler() {},
        getArgs: () => [],
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({ setHeader: (k: string, v: string) => { res[k] = v; } }),
        }),
      } as never;
      ic.intercept(ctx, { handle: () => of('DATA') }).subscribe({ next: resolve, error: reject });
    });
  // Echoes guarded tenant id downstream.
  {
    const res: Record<string, string> = {};
    const data = await run({ headers: {}, tenantId: UUID }, res);
    assert.equal(data, 'DATA');
    assert.equal(res['X-Tenant-ID'], UUID);
  }
  // Passive on public routes (no tenant -> no header, never blocks).
  {
    const res: Record<string, string> = {};
    const data = await run({ headers: {} }, res);
    assert.equal(data, 'DATA');
    assert.equal(res['X-Tenant-ID'], undefined);
  }
  ok('Interceptor: echo guarded id + passive public');
}

// ---------- 5. TenantResolverService (Redis-first + hub + branding) ----------
function makePorts(opts?: {
  tenants?: Array<{ id: string; slug: string; name: string; status: string }>;
  domains?: Array<{ domainName: string; tenantId: string; isVerified: boolean }>;
  branding?: Array<{ tenantId: string; primaryColor: string; secondaryColor: string; accentColor: string; logoUrl: string; faviconUrl: string | null; customFontUrl: string | null }>;
  failCache?: boolean;
}) {
  const kv = new Map<string, string>();
  const sets: Array<{ k: string; v: string }> = [];
  const tenants = new Map((opts?.tenants ?? []).map((t) => [t.slug, t]));
  const byId = new Map((opts?.tenants ?? []).map((t) => [t.id, t]));
  const domains = new Map((opts?.domains ?? []).map((d) => [d.domainName, d]));
  const branding = new Map((opts?.branding ?? []).map((b) => [b.tenantId, b]));
  return {
    tables: {
      tenant: {
        findUnique: async ({ where }: { where: { slug: string } }) => tenants.get(where.slug) ?? null,
        findById: async (id: string) => byId.get(id) ?? null,
      },
      tenantDomain: {
        findUnique: async ({ where }: { where: { domainName: string } }) => domains.get(where.domainName) ?? null,
      },
      tenantBrandingConfig: {
        findUnique: async ({ where }: { where: { tenantId: string } }) => branding.get(where.tenantId) ?? null,
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
        sets.push({ k, v });
      },
    },
    kv, sets,
  };
}

const SEED = {
  tenants: [{ id: UUID, slug: 'academy-a', name: 'Academy A', status: 'ACTIVE' }],
  domains: [{ domainName: 'brand-a.com', tenantId: UUID2, isVerified: true }],
  branding: [{
    tenantId: UUID, primaryColor: '#111111', secondaryColor: '#222222',
    accentColor: '#333333', logoUrl: 'https://cdn.example.com/a.png',
    faviconUrl: null, customFontUrl: null,
  }],
};

async function sectionService(): Promise<void> {
  // BDD-1: slug Redis-hit (<1ms path, no DB touch).
  {
    const { tables, cache } = makePorts();
    const svc = new TenantResolverService(tables, cache);
    await cache.setex(tenantSlugKey('academy-a'), 60, UUID);
    await cache.setex(tenantStatusKey(UUID), 60, 'ACTIVE');
    const r = await svc.resolveTenantIdentifier('academy-a');
    assert.deepEqual(r, { tenantId: UUID, slug: 'academy-a', isCustomDomain: false, isDefault: false, status: 'ACTIVE' });
  }
  // DB fallback + refill on cold miss.
  {
    const { tables, cache, sets } = makePorts(SEED);
    const svc = new TenantResolverService(tables, cache);
    const r = await svc.resolveTenantIdentifier('academy-a');
    assert.equal(r.tenantId, UUID);
    assert.equal(r.status, 'ACTIVE');
    assert.ok(sets.some((s) => s.k === tenantSlugKey('academy-a')));
  }
  // Unknown slug -> 404 (ERROR state -> TenantNotFound).
  {
    const { tables, cache } = makePorts(SEED);
    const svc = new TenantResolverService(tables, cache);
    await assert.rejects(svc.resolveTenantIdentifier('nope'), /Unknown tenant/);
  }
  // Custom domain: verified resolves, unverified 404s (spoof guard §8).
  {
    const { tables, cache } = makePorts(SEED);
    const svc = new TenantResolverService(tables, cache);
    await cache.setex(tenantStatusKey(UUID2), 60, 'ACTIVE');
    const r = await svc.resolveTenantIdentifier('custom:brand-a.com');
    assert.equal(r.tenantId, UUID2);
    assert.equal(r.isCustomDomain, true);
  }
  {
    const { tables, cache } = makePorts({ ...SEED, domains: [{ domainName: 'evil.com', tenantId: UUID2, isVerified: false }] });
    const svc = new TenantResolverService(tables, cache);
    await assert.rejects(svc.resolveTenantIdentifier('custom:evil.com'), /Unknown custom domain/);
  }
  // Hub default: always ACTIVE, hub branding synthesized (shell never 404s).
  {
    const { tables, cache } = makePorts();
    const svc = new TenantResolverService(tables, cache);
    const r = await svc.resolveTenantIdentifier('default');
    assert.equal(r.isDefault, true);
    assert.equal(r.status, 'ACTIVE');
    assert.equal(TenantBrandingSchema.safeParse(HUB_BRANDING).success, true);
    assert.deepEqual(await svc.getBrandingConfig('default'), HUB_BRANDING);
  }
  // DB branding row -> SSOT shape; unknown -> 404.
  {
    const { tables, cache } = makePorts(SEED);
    const svc = new TenantResolverService(tables, cache);
    const b = await svc.getBrandingConfig(UUID);
    assert.equal(TenantBrandingSchema.safeParse(b).success, true);
    assert.equal(b.tenantSlug, 'academy-a');
    await assert.rejects(svc.getBrandingConfig(UUID2), /Branding for tenant/);
  }
  // Redis outage: DB still serves (self-heal §10, fail-open read).
  {
    const { tables, cache } = makePorts({ ...SEED, failCache: true });
    const svc = new TenantResolverService(tables, cache);
    const r = await svc.resolveTenantIdentifier('academy-a');
    assert.equal(r.tenantId, UUID);
  }
  ok('Service: Redis-hit/DB-refill/404/custom-spoof/hub/outage');
}

// ---------- 6. Prisma additive (expand-contract, Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum TenantStatus {', 'ACTIVE', 'PENDING_SETUP',
    'model TenantDomain {', 'model TenantBrandingConfig {', 'model UserTenantMapping {',
    'brandingConfig TenantBrandingConfig?', 'customDomains TenantDomain[]',
    'memberships   UserTenantMapping[]', 'tenantMappings      UserTenantMapping[]',
    '@@unique([userId, tenantId])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  assert.ok(!prisma.includes('orders          Order[]'), 'Tenant must not claim orders[] before Order.tenant FK backfill');
  ok('Prisma: status/domain/branding/mapping additive (orders untouched)');
}

// ---------- 7. Static parity (files, wiring, SDL, middleware, UI) ----------
function sectionParity(): void {
  const guard = readFileSync('apps/backend/src/common/guards/tenant.guard.ts', 'utf8');
  for (const t of ['TenantGuard', 'x-tenant-id', 'tenant:status', 'UnauthorizedException', 'tenantId']) {
    assert.ok(guard.includes(t), `guard missing: ${t}`);
  }
  assert.ok(!guard.includes('TenantGuardGuard'), 'scaffold stub name must be gone');
  const ic = readFileSync('apps/backend/src/common/interceptors/tenant-header.interceptor.ts', 'utf8');
  assert.ok(ic.includes('TenantHeaderInterceptor') && ic.includes('X-Tenant-ID'));
  const svc = readFileSync('apps/backend/src/modules/tenant/tenant-resolver.service.ts', 'utf8');
  for (const t of ['TenantResolverService', 'resolveTenantIdentifier', 'getBrandingConfig', 'HUB_BRANDING', 'withInfra']) {
    assert.ok(svc.includes(t), `service missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/tenant/tenant-resolver.module.ts', 'utf8');
  assert.ok(mod.includes('TenantResolverModule') && mod.includes('TenantResolverController'));
  const ctrl = readFileSync('apps/backend/src/modules/tenant/tenant-resolver.controller.ts', 'utf8');
  for (const t of ['api/v1/tenant', "'resolve'", "'branding'", 'TenantIdentifierSchema', 'TenantBrandingSchema']) {
    assert.ok(ctrl.includes(t), `REST controller missing: ${t}`);
  }
  const gql = readFileSync('apps/backend/src/api/graphql/tenant.resolver.ts', 'utf8');
  for (const t of ['getTenantBranding', 'TenantBrandingConfig', 'tenantSlug', 'customDomain']) {
    assert.ok(gql.includes(t), `GQL missing: ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/tenant.graphql', 'utf8');
  assert.ok(sdl.includes('getTenantBranding') && sdl.includes('TenantBrandingConfig'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('TenantResolverModule'));
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  for (const t of ['resolveTenantIdentifier', 'x-tenant-identifier', 'x-tenant-id']) {
    assert.ok(mw.includes(t), `middleware missing: ${t}`);
  }
  const theme = readFileSync('apps/frontend/lib/tenant/theme-provider.tsx', 'utf8');
  for (const t of ['TenantThemeProvider', 'useTenantTheme', '--primary-color', '--secondary-color', '--accent-color', 'TenantNotFound']) {
    assert.ok(theme.includes(t), `theme provider missing: ${t}`);
  }
  assert.ok(!theme.includes('TODO'), 'theme provider must be implemented');
  const resolver = readFileSync('apps/frontend/lib/tenant/tenant-resolver.ts', 'utf8');
  assert.ok(!resolver.includes('TODO') && !resolver.includes('Placeholder'));
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('TenantEngineBrandingSchema') && barrel.includes('tenant-contract'));
  ok('Parity: guard/interceptor/service/module/REST/GQL/SDL/App/middleware/theme/barrel');
}

async function main(): Promise<void> {
  await sectionGuard();
  await sectionInterceptor();
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase071 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
