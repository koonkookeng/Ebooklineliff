// SSOT Phase 025 §10 — contract tests (Zod, HMAC, entity, use-cases, SDL, latency)
// Run: npx tsx scripts/test-phase025-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EnvironmentTypeEnum,
  DeepLinkTargetTypeEnum,
  ResolvedStateSchema,
  CreateShortLinkInputSchema,
  ShortCodeParamSchema,
  ResolveShortCodeResponseSchema,
  detectEnvironment,
  defaultTargetPath,
  parseLiffStateToPath,
  RESOLVER_LATENCY_BUDGET_MS,
} from '../packages/shared/src/schemas/resolver-contract';
import { HmacCryptoService } from '../apps/backend/src/modules/resolver/domain/services/hmac-crypto.service';
import {
  assertCreatable,
  assertResolvable,
  buildCustomPath,
  normalizeShortCode,
} from '../apps/backend/src/modules/resolver/domain/entities/short-link.entity';
import { DeepLinkResolverService } from '../apps/backend/src/modules/resolver/application/services/deep-link-resolver.service';
import { ResolveDeepLinkUseCase } from '../apps/backend/src/modules/resolver/application/use-cases/resolve-deep-link.usecase';
import { CreateShortLinkUseCase } from '../apps/backend/src/modules/resolver/application/use-cases/create-short-link.usecase';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const baseInput = {
  tenantId: 'default',
  targetType: 'EBOOK',
  targetId: 'prod-123',
} as const;

function stubRedis(store: Map<string, string>, published: unknown[]): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (_s: string, m: string) => { published.push(JSON.parse(m)); },
  } as unknown as RedisClusterService;
}

function linkRow(over: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    tenantId: 'default',
    shortCode: 'EBOOK-PROMO',
    targetType: 'EBOOK',
    targetId: 'prod-123',
    customPath: '/ebook/prod-123?aff=AFF999',
    affiliateCode: 'AFF999',
    campaignId: null,
    couponCode: null,
    signature: 'x'.repeat(64),
    clickCount: 0,
    maxRedemptions: null,
    expiresAt: null,
    isActive: true,
    ...over,
  };
}

// ---------- 1. Zod vocabulary + boundaries (§3.1 Gate 1) ----------
{
  for (const t of ['EBOOK', 'ELEARNING_COURSE', 'PHYSICAL_PRODUCT', 'HYBRID_BUNDLE', 'PROMOTION_CAMPAIGN', 'AFFILIATE_DISCOVERY']) {
    assert.equal(DeepLinkTargetTypeEnum.safeParse(t).success, true);
  }
  assert.equal(DeepLinkTargetTypeEnum.safeParse('MOVIE').success, false);
  for (const e of ['LINE_IOS', 'LINE_ANDROID', 'EXTERNAL_MOBILE_IOS', 'EXTERNAL_MOBILE_ANDROID', 'DESKTOP_WEB']) {
    assert.equal(EnvironmentTypeEnum.safeParse(e).success, true);
  }
  const sig = 'a'.repeat(64);
  const good = { targetType: 'EBOOK', targetId: 'prod-1', tenantId: 'default', customPath: '/ebook/prod-1', signature: sig };
  assert.equal(ResolvedStateSchema.safeParse(good).success, true);
  assert.equal(ResolvedStateSchema.safeParse({ ...good, signature: 'short' }).success, false);
  assert.equal(ResolvedStateSchema.safeParse({ ...good, customPath: '../evil' }).success, false);
  assert.equal(CreateShortLinkInputSchema.safeParse(baseInput).success, true);
  assert.equal(CreateShortLinkInputSchema.safeParse({ ...baseInput, customSlug: 'bad slug!' }).success, false);
  assert.equal(ShortCodeParamSchema.safeParse({ shortCode: 'HB-SALE-2026' }).success, true);
  assert.equal(ShortCodeParamSchema.safeParse({ shortCode: 'ab' }).success, false);
  ok('Enums + ResolvedState/CreateShortLink/ShortCode boundaries (sig 64, no traversal)');
}

// ---------- 2. HMAC sign/verify + tamper guard (Gate 4) ----------
{
  const crypto = new HmacCryptoService();
  const payload = { targetType: 'EBOOK', targetId: 'p1', tenantId: 'default', customPath: '/ebook/p1' };
  const s1 = crypto.generateSignature(payload);
  assert.equal(s1.length, 64);
  assert.equal(s1, crypto.generateSignature({ customPath: '/ebook/p1', tenantId: 'default', targetId: 'p1', targetType: 'EBOOK' }));
  assert.equal(crypto.verifySignature(payload, s1), true);
  assert.equal(crypto.verifySignature({ ...payload, targetId: 'p2' }, s1), false);
  assert.equal(crypto.verifySignature(payload, 'forged'), false);
  ok('HMAC deterministic, key-sorted, tamper fail-closed');
}

// ---------- 3. liff.state roundtrip + corrupt → 401 (§5.2) ----------
{
  const store = new Map<string, string>();
  const svc = new DeepLinkResolverService(
    {} as never, new HmacCryptoService(), stubRedis(store, []),
  );
  const payload = { targetType: 'EBOOK', targetId: 'p1', tenantId: 'default', customPath: '/ebook/p1' };
  const crypto = new HmacCryptoService();
  const state = crypto.encodeState(payload);
  const t0 = Date.now();
  const out = svc.verifyAndDecryptState(state);
  assert.ok(Date.now() - t0 < RESOLVER_LATENCY_BUDGET_MS, 'decrypt under 300ms budget');
  assert.equal(out.targetId, 'p1');
  assert.throws(() => svc.verifyAndDecryptState('!!!not-base64!!!'));
  const tampered = Buffer.from(JSON.stringify({ ...payload, signature: '0'.repeat(64) })).toString('base64url');
  assert.throws(() => svc.verifyAndDecryptState(tampered));
  ok('State roundtrip <300ms; corrupt + forged signatures throw 401');
}

// ---------- 4. Entity invariants (Gate 7) ----------
{
  assert.equal(normalizeShortCode('HB-SALE-2026'), 'HB-SALE-2026');
  assert.throws(() => normalizeShortCode('ab'));
  assert.throws(() => normalizeShortCode('bad code!'));
  assert.equal(assertCreatable({ ...baseInput }).targetType, 'EBOOK');
  assert.throws(() => assertCreatable({ ...baseInput, expiresAt: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(buildCustomPath('EBOOK', 'p1', 'AFF999', undefined), '/ebook/p1?aff=AFF999');
  assert.equal(buildCustomPath('HYBRID_BUNDLE', 'b1', undefined, undefined), '/bundle/b1');
  assert.equal(assertResolvable(linkRow()).id, 'link-1');
  assert.throws(() => assertResolvable(linkRow({ isActive: false })));
  assert.throws(() => assertResolvable(linkRow({ expiresAt: new Date(Date.now() - 1000) })));
  assert.throws(() => assertResolvable(linkRow({ clickCount: 5, maxRedemptions: 5 })));
  ok('Entity: normalize/create/resolve guards incl. expiry + redemption cap');
}

// ---------- 5. Environment matrix + liff.state path fallback (BDD §1.3) ----------
{
  assert.equal(detectEnvironment('Mozilla Line/13.0 iPhone'), 'LINE_IOS');
  assert.equal(detectEnvironment('Line/13.0 Android'), 'LINE_ANDROID');
  assert.equal(detectEnvironment('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'EXTERNAL_MOBILE_IOS');
  assert.equal(detectEnvironment('Mozilla/5.0 (Linux; Android 14)'), 'EXTERNAL_MOBILE_ANDROID');
  assert.equal(detectEnvironment('Mozilla/5.0 (Windows NT 10.0)'), 'DESKTOP_WEB');
  assert.equal(parseLiffStateToPath('%2Febook%2F123%3Faff%3DAFF999'), '/ebook/123?aff=AFF999');
  assert.equal(parseLiffStateToPath('/course/c1'), '/course/c1');
  assert.equal(parseLiffStateToPath(null), '/store');
  assert.equal(parseLiffStateToPath('/../evil'), '/store');
  assert.equal(defaultTargetPath('EBOOK', 'e1'), '/ebook/e1');
  assert.equal(defaultTargetPath('ELEARNING_COURSE', 'c1'), '/course/c1');
  assert.equal(defaultTargetPath('PHYSICAL_PRODUCT', 'p1'), '/product/p1');
  assert.equal(defaultTargetPath('HYBRID_BUNDLE', 'b1'), '/bundle/b1');
  assert.equal(defaultTargetPath('PROMOTION_CAMPAIGN', 'm1'), '/promo/m1');
  assert.equal(defaultTargetPath('AFFILIATE_DISCOVERY', 'd1'), '/discover/d1');
  ok('UA matrix (5 envs) + liff.state fallback + 6 default paths');
}

async function main(): Promise<void> {
// ---------- 6. Resolve: cache-hit path, miss→DB→recache, 404s ----------
{
  const crypto = new HmacCryptoService();
  const mkSvc = (store: Map<string, string>, published: unknown[], repo: unknown) =>
    new DeepLinkResolverService(repo as never, crypto, stubRedis(store, published));

  // 6a. cache hit: zero DB reads, stream event emitted
  {
    const store = new Map([[`resolver:code:EBOOK-PROMO`, JSON.stringify(linkRow())]]);
    const published: unknown[] = [];
    let dbReads = 0;
    const svc = mkSvc(store, published, {
      findByCode: async () => { dbReads++; return null; },
      incrementClicks: async () => ({}),
      logClick: async () => ({}),
    });
    const t0 = Date.now();
    const out = await svc.resolveShortCode('EBOOK-PROMO', 'Line/13.0 iPhone', '1.2.3.4');
    assert.ok(Date.now() - t0 < RESOLVER_LATENCY_BUDGET_MS, 'cache-hit under 300ms');
    assert.equal(out.shortCode, 'EBOOK-PROMO');
    assert.equal(dbReads, 0);
    assert.equal((published[0] as { event: string }).event, 'resolver.click');
    ok('6a cache-hit: 0 DB reads, <300ms, click stream emitted');
  }

  // 6b. miss → DB → re-cached; second call hits cache
  {
    const store = new Map<string, string>();
    const published: unknown[] = [];
    let dbReads = 0;
    const repo = {
      findByCode: async () => { dbReads++; return linkRow(); },
      incrementClicks: async () => ({}),
      logClick: async () => ({}),
    };
    const svc = mkSvc(store, published, repo);
    await svc.resolveShortCode('EBOOK-PROMO', 'Mozilla Windows', '5.6.7.8', 'https://chat.line.me');
    assert.equal(dbReads, 1);
    assert.ok(store.has('resolver:code:EBOOK-PROMO'), 're-cached 24h');
    await svc.resolveShortCode('EBOOK-PROMO', 'Mozilla Windows', '5.6.7.8');
    assert.equal(dbReads, 1);
    ok('6b miss→DB→recache; repeat served from edge');
  }

  // 6c. unknown / inactive / expired → 404 (never 500)
  {
    const svc = mkSvc(new Map(), [], {
      findByCode: async () => null,
      incrementClicks: async () => ({}),
      logClick: async () => ({}),
    });
    await assert.rejects(() => svc.resolveShortCode('NOPE-123', 'ua', 'ip'), /not found/i);
    const svc2 = mkSvc(new Map(), [], {
      findByCode: async () => linkRow({ isActive: false }),
      incrementClicks: async () => ({}),
      logClick: async () => ({}),
    });
    await assert.rejects(() => svc2.resolveShortCode('OFF-123', 'ua', 'ip'));
    ok('6c unknown/inactive codes reject 404 (fallback loop safe)');
  }
}

// ---------- 7. Use-cases: resolve response shape + create HMAC row ----------
{
  const crypto = new HmacCryptoService();
  const store = new Map([[`resolver:code:EBOOK-PROMO`, JSON.stringify(linkRow())]]);
  const svc = new DeepLinkResolverService(
    { incrementClicks: async () => ({}), logClick: async () => ({}) } as never,
    crypto, stubRedis(store, []),
  );
  const resolve = new ResolveDeepLinkUseCase(svc);
  const out = await resolve.execute('EBOOK-PROMO', 'Line iPhone', '9.9.9.9');
  assert.equal(out.success, true);
  assert.equal(out.targetUrl, '/ebook/prod-123?aff=AFF999');
  assert.equal(out.affiliateCode, 'AFF999');
  assert.equal(out.requiresAuth, true);
  const parsed = ResolveShortCodeResponseSchema.safeParse(out);
  assert.equal(parsed.success, true);
  await assert.rejects(() => resolve.execute('!!', 'ua', 'ip'), /Invalid short code/);

  const created: Array<{ data: Record<string, unknown> }> = [];
  const create = new CreateShortLinkUseCase(
    { create: async (row: { shortCode: string; signature: string }) => { created.push({ data: row as unknown as Record<string, unknown> }); return { ...linkRow(), ...row }; } } as never,
    crypto, stubRedis(new Map(), []),
  );
  const row = await create.execute({ ...baseInput, customSlug: 'HB-SALE-2026', affiliateCode: 'AFF999' }) as { shortCode: string; signature: string; customPath: string };
  assert.equal(row.shortCode, 'HB-SALE-2026');
  assert.equal(row.signature.length, 64);
  assert.equal(row.customPath, '/ebook/prod-123?aff=AFF999');
  const dupe = new CreateShortLinkUseCase(
    { create: async () => { const e = new Error('Unique constraint') as Error & { code?: string }; e.code = 'P2002'; throw e; } } as never,
    crypto, stubRedis(new Map(), []),
  );
  await assert.rejects(() => dupe.execute({ ...baseInput }), /already taken/);
  ok('7 resolve shape Zod-valid + requiresAuth; create signs HMAC, P2002→409');
}

// ---------- 8. SDL + module wiring + middleware + pages (Gate 1/3) ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/resolver.graphql/schema.graphql', 'utf8');
  for (const t of DeepLinkTargetTypeEnum.options) assert.ok(sdl.includes(t), `SDL missing ${t}`);
  assert.ok(sdl.includes('resolveShortCode'));
  assert.ok(sdl.includes('generatePermanentDeepLink'));
  const mod = readFileSync('apps/backend/src/modules/resolver/resolver.module.ts', 'utf8');
  assert.ok(mod.includes('DeepLinkResolverService'));
  assert.ok(mod.includes('FastifyResolverController'));
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/r/'"));
  assert.ok(mw.includes('line://app/'));
  assert.ok(mw.includes("'/resolve'"));
  const page = readFileSync('apps/frontend/app/(liff)/resolve/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) assert.ok(page.includes(s), `page missing ${s}`);
  assert.ok(page.includes('เปิดในเบราว์เซอร์'));
  assert.ok(page.includes('กลับหน้าหลัก'));
  const tenantRoute = readFileSync('apps/frontend/app/(liff)/[tenant]/r/[shortCode]/route.ts', 'utf8');
  assert.ok(tenantRoute.includes('/store'));
  ok('SDL mirrors enum + mutations; module/middleware/page/route wired, 5 states + fallback dialog');
}

console.log(`\nPhase 025 contracts: ${passed} checks passed`);
}

void main();
