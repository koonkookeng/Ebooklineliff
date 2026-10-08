// SSOT Phase 080 §10-11 — contract tests (Zod, HMAC, flex, usecases, parity)
// Run: npx tsx scripts/test-phase080-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FlexTargetTypeEnum,
  FlexShareInputSchema,
  FlexSharePayloadSchema,
  TrackClickPayloadSchema,
  AffiliateShareMetricsSchema,
  FLEX_REF_TOKEN_TTL_SEC,
  FLEX_GENERATE_RATE_LIMIT,
  FLEX_CLICK_STREAM,
  FLEX_SHARE_STREAM,
  signRefToken,
  verifyRefToken,
  flexReferralUrl,
  ctrOf,
  flexSessionKey,
  flexGenerateRateKey,
} from '../packages/shared/src/schemas/flex-share.schema';
import { AttributionSigner } from '../apps/backend/src/modules/share/domain/attribution.signer';
import { buildShareFlexCard, assertFlexSize, FlexBuilderEngine } from '../apps/backend/src/modules/share/domain/flex-builder.engine';
import { GenerateFlexShareUseCase } from '../apps/backend/src/modules/share/application/generate-flex-share.usecase';
import { TrackClickUseCase } from '../apps/backend/src/modules/share/application/track-click.usecase';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const TENANT = 'emerald-mall';
const SECRET = 'test-secret-080';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(FlexTargetTypeEnum.safeParse('PRODUCT_PDP').success, true);
  assert.equal(FlexTargetTypeEnum.safeParse('AFFILIATE_STOREFRONT').success, true);
  assert.equal(FlexTargetTypeEnum.safeParse('BANNER').success, false);
  assert.equal(
    FlexShareInputSchema.safeParse({ tenantId: TENANT, productId: UUID, targetType: 'PRODUCT_PDP' }).success,
    true,
  );
  assert.equal(
    FlexShareInputSchema.safeParse({
      tenantId: TENANT, productId: UUID, targetType: 'EBOOK_PREVIEW', customMessage: 'อ่านเลย!',
    }).success,
    true,
  );
  assert.equal(
    FlexShareInputSchema.safeParse({ tenantId: TENANT, productId: 'nope', targetType: 'PRODUCT_PDP' }).success,
    false,
  );
  assert.equal(
    FlexShareInputSchema.safeParse({ tenantId: '', productId: UUID, targetType: 'PRODUCT_PDP' }).success,
    false,
  );
  assert.equal(
    FlexShareInputSchema.safeParse({ tenantId: TENANT, productId: UUID, targetType: 'NOPE' }).success,
    false,
  );
  assert.equal(
    FlexShareInputSchema.safeParse({ tenantId: TENANT, productId: UUID, targetType: 'PRODUCT_PDP', customMessage: 'x'.repeat(101) }).success,
    false,
  );
  assert.equal(
    FlexSharePayloadSchema.safeParse({
      flexMessageJson: '{}', referralUrl: 'https://liff.line.me/p/x?refToken=a', refToken: 'a', expiresAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    FlexSharePayloadSchema.safeParse({ flexMessageJson: '{}', referralUrl: 'nope', refToken: 'a', expiresAt: 'x' }).success,
    false,
  );
  assert.equal(TrackClickPayloadSchema.safeParse({ success: true, affiliateCode: 'A', isNewSession: true }).success, true);
  assert.equal(TrackClickPayloadSchema.safeParse({ success: 'y', affiliateCode: 'A', isNewSession: true }).success, false);
  assert.equal(
    AffiliateShareMetricsSchema.safeParse({ totalShares: 2, totalClicks: 5, conversions: 1, estimatedEarnings: 130, ctrPercentage: 250 }).success,
    false,
  );
  assert.equal(
    AffiliateShareMetricsSchema.safeParse({ totalShares: 2, totalClicks: 5, conversions: 1, estimatedEarnings: 130, ctrPercentage: 99.9 }).success,
    true,
  );
  ok('Zod §3.1 verbatim (target/input/payload/click/metrics gates)');
}

// ---------- 2. HMAC token + URL/CTR helpers (§8.1/BDD-2) ----------
{
  assert.equal(FLEX_REF_TOKEN_TTL_SEC, 30 * 24 * 60 * 60);
  assert.equal(FLEX_GENERATE_RATE_LIMIT, 10);
  assert.equal(FLEX_CLICK_STREAM, 'share:flex:clicks');
  assert.equal(FLEX_SHARE_STREAM, 'share:flex:generated');
  const tok = signRefToken(SECRET, { userId: UUID_B, productId: UUID, affiliateCode: 'AFF1' });
  const claims = verifyRefToken(SECRET, tok);
  assert.deepEqual(claims, { userId: UUID_B, productId: UUID, affiliateCode: 'AFF1', issuedAt: claims?.issuedAt });
  assert.equal(verifyRefToken('wrong-secret', tok), null);
  assert.equal(verifyRefToken(SECRET, 'not-base64!!!'), null);
  assert.equal(verifyRefToken(SECRET, Buffer.from('a:b:c').toString('base64url')), null);
  const old = signRefToken(SECRET, { userId: UUID_B, productId: UUID, affiliateCode: 'A', issuedAt: Date.now() - FLEX_REF_TOKEN_TTL_SEC * 1000 - 1000 });
  assert.equal(verifyRefToken(SECRET, old), null);
  const url = flexReferralUrl('https://liff.line.me/', UUID, tok);
  assert.ok(url.includes(`/p/${UUID}?refToken=`), `referralUrl: ${url}`);
  assert.equal(ctrOf(5, 2), 250);
  assert.equal(ctrOf(1, 2), 50);
  assert.equal(ctrOf(0, 0), 0);
  assert.equal(flexSessionKey('t', 'v'), 'share:flex:session:t:v');
  assert.equal(flexGenerateRateKey('u'), 'share:flex:gen:u');
  ok('HMAC sign/verify (tamper+expiry) + referral URL + CTR/keys');
}

// ---------- 3. Signer service (env-first secret, expiry instant) ----------
{
  const s = new AttributionSigner(SECRET);
  const tok = s.sign({ userId: UUID_B, productId: UUID, affiliateCode: 'AFF1' });
  const claims = s.verify(tok);
  assert.equal(claims?.affiliateCode, 'AFF1');
  assert.ok(Date.parse(s.expiresAt()) > Date.now());
  assert.equal(new AttributionSigner('other').verify(tok), null);
  ok('AttributionSigner: sign/verify/expiresAt parity');
}

// ---------- 4. Flex mega-bubble builder (§5.2/Gate 5/6) ----------
{
  const card = buildShareFlexCard({
    title: 'Ebook A',
    description: 'Desc',
    coverImageUrl: 'https://r2.example.com/cover.webp',
    price: 1000,
    discountPrice: 799,
    productType: 'EBOOK',
    referralUrl: 'https://liff.line.me/p/x?refToken=t',
    affiliateCode: 'AFF1',
    primaryColor: '#059669',
  }) as { type: string; altText: string; contents: { type: string; size: string; hero: { url: string; action: { uri: string } }; body: { contents: Array<{ text?: string }> }; footer: { contents: Array<{ color?: string; action?: { uri: string } }> } } };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('Ebook A'));
  assert.equal(card.contents.size, 'mega');
  assert.equal(card.contents.hero.url, 'https://r2.example.com/cover.webp');
  assert.ok(card.contents.hero.action.uri.includes('refToken=t'));
  const texts = JSON.stringify(card.contents.body);
  assert.ok(texts.includes('Ebook A') && texts.includes('799') && texts.includes('1,000'));
  assert.equal(card.contents.footer.contents[0]?.color, '#059669');
  const plain = buildShareFlexCard({
    title: 'T', description: 'D', coverImageUrl: 'https://r2.example.com/c.webp',
    price: 500, productType: 'PHYSICAL_BOOK', referralUrl: 'https://liff.line.me/p/y',
    affiliateCode: 'A',
  });
  assert.ok(!JSON.stringify(plain).includes('line-through'));
  assert.doesNotThrow(() => assertFlexSize(JSON.stringify(card)));
  assert.throws(() => assertFlexSize('x'.repeat(60 * 1024)), /50KB/);
  ok('Flex: mega bubble + discount strike + tenant CTA + 50KB guard');
}

// ---------- 5. Generate use-case (BDD-1: rate/Zod/404/tenant/atomic) ----------
async function sectionGenerate(): Promise<void> {
  function ports() {
    const events: string[] = [];
    const created: unknown[] = [];
    const repo = {
      findProduct: async () => ({
        id: UUID, tenantId: TENANT, title: 'Ebook A', description: 'Desc',
        coverImageUrl: 'https://r2.example.com/c.webp', price: 1000, discountPrice: 799, productType: 'EBOOK',
      }),
      createShareEvent: async (a: unknown) => { created.push(a); return { id: 'se-1' }; },
      withTx(tx: unknown) { return this; },
    };
    let hits = 0;
    const cache = {
      bumpGenerate: async () => ++hits,
      emit: async (s: string) => { events.push(s); },
      sessionSeen: async () => false,
      rememberSession: async () => undefined,
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    return { repo, cache, tx, events, created, getHits: () => hits };
  }
  {
    const p = ports();
    const svc = new GenerateFlexShareUseCase(p.repo as never, p.cache, new AttributionSigner(SECRET), new FlexBuilderEngine(), p.tx);
    const r = await svc.execute({
      tenantId: TENANT, userId: UUID_B, affiliateCode: 'AFF1',
      input: { productId: UUID, targetType: 'PRODUCT_PDP' },
    });
    assert.ok(r.referralUrl.includes('refToken='));
    assert.ok(r.refToken.length > 20);
    assert.ok(Date.parse(r.expiresAt) > Date.now());
    assert.ok(JSON.parse(r.flexMessageJson));
    assert.equal(p.created.length, 1);
    assert.ok(p.events.includes(FLEX_SHARE_STREAM));
  }
  // P2002 same-ms double submit → one re-sign retry, both card CTAs rewritten.
  {
    const p = ports();
    let calls = 0;
    const flaky = {
      ...p.repo,
      createShareEvent: async (a: unknown) => {
        if (++calls === 1) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        return { id: 'se-2' };
      },
    };
    const svc = new GenerateFlexShareUseCase(flaky as never, p.cache, new AttributionSigner(SECRET), new FlexBuilderEngine(), p.tx);
    const r = await svc.execute({
      tenantId: TENANT, userId: UUID_B, affiliateCode: 'AFF1',
      input: { productId: UUID, targetType: 'PRODUCT_PDP' },
    });
    assert.equal(calls, 2);
    assert.ok(r.referralUrl.includes(encodeURIComponent(r.refToken).slice(0, 8)));
    const occurrences = r.flexMessageJson.split(r.referralUrl).length - 1;
    assert.equal(occurrences, 2);
  }
  // Gates: rate-limit / bad input / missing product / cross-tenant.
  {
    const p = ports();
    for (let i = 0; i < 10; i++) await p.cache.bumpGenerate();
    const svc = new GenerateFlexShareUseCase(p.repo as never, p.cache, new AttributionSigner(SECRET), new FlexBuilderEngine(), p.tx);
    await assert.rejects(
      svc.execute({ tenantId: TENANT, userId: UUID_B, affiliateCode: 'A', input: { productId: UUID, targetType: 'PRODUCT_PDP' } }),
      /rate limit/,
    );
  }
  {
    const p = ports();
    const svc = new GenerateFlexShareUseCase(p.repo as never, p.cache, new AttributionSigner(SECRET), new FlexBuilderEngine(), p.tx);
    await assert.rejects(
      svc.execute({ tenantId: TENANT, userId: UUID_B, affiliateCode: 'A', input: { productId: 'nope', targetType: 'PRODUCT_PDP' } }),
      /Invalid flex share/,
    );
    const missing = { ...p, repo: { ...p.repo, findProduct: async () => null } };
    const s2 = new GenerateFlexShareUseCase(missing.repo as never, p.cache, new AttributionSigner(SECRET), new FlexBuilderEngine(), p.tx);
    await assert.rejects(
      s2.execute({ tenantId: TENANT, userId: UUID_B, affiliateCode: 'A', input: { productId: UUID, targetType: 'PRODUCT_PDP' } }),
      /Product not found/,
    );
    const foreign = {
      ...p,
      repo: { ...p.repo, findProduct: async () => ({ id: UUID, tenantId: 'other', title: 'T', description: 'D', coverImageUrl: 'u', price: 1, discountPrice: null, productType: 'EBOOK' }) },
    };
    const s3 = new GenerateFlexShareUseCase(foreign.repo as never, p.cache, new AttributionSigner(SECRET), new FlexBuilderEngine(), p.tx);
    await assert.rejects(
      s3.execute({ tenantId: TENANT, userId: UUID_B, affiliateCode: 'A', input: { productId: UUID, targetType: 'PRODUCT_PDP' } }),
      /Cross-tenant/,
    );
  }
  ok('Generate: signed card + atomic persist + rate/Zod/404/tenant gates');
}

// ---------- 6. Track-click use-case (BDD-2: verify/session/atomic/self-block) ----------
async function sectionTrack(): Promise<void> {
  function ports(sharerLineId: string | null = 'line-sharer') {
    const clicks: unknown[] = [];
    const emitted: string[] = [];
    const sessions = new Set<string>();
    const signer = new AttributionSigner(SECRET);
    const refToken = signer.sign({ userId: UUID_B, productId: UUID, affiliateCode: 'AFF1' });
    const repo = {
      findShareEventByRefToken: async (t: string) =>
        t === refToken ? { id: 'se-1', userId: UUID_B, productId: UUID, targetType: 'PRODUCT_PDP', refToken, clickCount: 0 } : null,
      findUser: async () => ({ id: UUID_B, affiliateCode: 'AFF1', lineUserId: sharerLineId }),
      recordClick: async (a: unknown) => { clicks.push(a); },
      withTx(tx: unknown) { return this; },
    };
    const cache = {
      sessionSeen: async (t: string, v: string) => sessions.has(`${t}:${v}`),
      rememberSession: async (t: string, v: string) => { sessions.add(`${t}:${v}`); },
      bumpGenerate: async () => 1,
      emit: async (s: string) => { emitted.push(s); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    return { repo, cache, tx, signer, refToken, clicks, emitted };
  }
  // Happy path: new session → click row + counter event.
  {
    const p = ports();
    const svc = new TrackClickUseCase(p.repo as never, p.cache, p.signer, p.tx);
    const r = await svc.execute({ refToken: p.refToken, visitorLineId: 'line-visitor', ipAddress: '1.1.1.1', userAgent: 'LINE' });
    assert.deepEqual(r, { success: true, affiliateCode: 'AFF1', isNewSession: true, productId: UUID });
    assert.equal(p.clicks.length, 1);
    assert.ok(p.emitted.includes(FLEX_CLICK_STREAM));
    const r2 = await svc.execute({ refToken: p.refToken, visitorLineId: 'line-visitor', ipAddress: '1.1.1.1', userAgent: 'LINE' });
    assert.equal(r2.isNewSession, false);
    assert.equal(p.clicks.length, 2);
  }
  // Self-click blocked (fraud stream, no click row).
  {
    const p = ports('line-sharer');
    const svc = new TrackClickUseCase(p.repo as never, p.cache, p.signer, p.tx);
    const r = await svc.execute({ refToken: p.refToken, visitorLineId: 'line-sharer', ipAddress: '1.1.1.1', userAgent: 'LINE' });
    assert.equal(r.success, false);
    assert.equal(r.isNewSession, false);
    assert.equal(p.clicks.length, 0);
    assert.ok(p.emitted.includes('affiliate:fraud:events'));
  }
  // Tampered + unknown tokens → success:false (never throws).
  {
    const p = ports();
    const svc = new TrackClickUseCase(p.repo as never, p.cache, p.signer, p.tx);
    assert.deepEqual(
      await svc.execute({ refToken: 'garbage', visitorLineId: null, ipAddress: '1.1.1.1', userAgent: 'u' }),
      { success: false, affiliateCode: '', isNewSession: false, productId: null },
    );
    const other = new AttributionSigner(SECRET).sign({ userId: UUID_B, productId: UUID, affiliateCode: 'AFF1', issuedAt: Date.now() + 2 });
    const r = await svc.execute({ refToken: other, visitorLineId: null, ipAddress: '1.1.1.1', userAgent: 'u' });
    assert.equal(r.success, false);
    assert.equal(r.affiliateCode, 'AFF1');
  }
  ok('Track: session/new-repeat + self-block + tamper/unknown safe');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model AffiliateClick {',
    'shareEvent       ShareEvent @relation(fields: [shareEventId], references: [id], onDelete: Cascade)',
    'convertedOrderId String?    @unique',
    'clicks       AffiliateClick[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: AffiliateClick ledger + ShareEvent.clicks relation');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/share/domain/attribution.signer.ts',
    'apps/backend/src/modules/share/domain/flex-builder.engine.ts',
    'apps/backend/src/modules/share/domain/share.repository.ts',
    'apps/backend/src/modules/share/infrastructure/share.repository.ts',
    'apps/backend/src/modules/share/infrastructure/share-redis.cache.ts',
    'apps/backend/src/modules/share/application/generate-flex-share.usecase.ts',
    'apps/backend/src/modules/share/application/track-click.usecase.ts',
    'apps/backend/src/modules/share/presentation/share.controller.ts',
    'apps/backend/src/modules/share/presentation/share.resolver.ts',
    'apps/backend/src/modules/share/share.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/share/share.module.ts', 'utf8');
  assert.ok(mod.includes('ShareModule') && mod.includes('GenerateFlexShareUseCase') && mod.includes('TrackClickUseCase'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ShareModule'));
  const gql = readFileSync('apps/backend/src/modules/share/presentation/share.resolver.ts', 'utf8');
  assert.ok(gql.includes('trackAffiliateClick') && gql.includes('getAffiliateShareMetrics'));
  assert.ok(!gql.includes("Query('generateProductFlexShare')"), 'GQL field collision with 026/079');
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/share-click.graphql', 'utf8');
  assert.ok(sdl.includes('TrackClickPayload') && sdl.includes('AffiliateMetricsPayload') && sdl.includes('trackAffiliateClick'));
  for (const p of [
    'apps/frontend/components/share/FlexShareButton.tsx',
    'apps/frontend/hooks/useLineFlexShare.ts',
    'apps/frontend/app/(liff)/share/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useLineFlexShare.ts', 'utf8');
  assert.ok(
    hook.includes('LIFF_INIT') && hook.includes('LOADING') && hook.includes('SUCCESS') && hook.includes('ERROR'),
    '5-state hook',
  );
  assert.ok(hook.includes('shareTargetPicker') && hook.includes('clipboard'), 'picker + fallback');
  assert.ok(!hook.includes("from '@line/liff'") && !hook.includes("from '@apollo/client'"), 'zero-dep LIFF (window.liff + REST)');
  const btn = readFileSync('apps/frontend/components/share/FlexShareButton.tsx', 'utf8');
  assert.ok(btn.includes('FlexShareButton') && btn.includes('role="alert"'));
  for (const p of [
    'apps/frontend/app/api/v1/share/flex-generate/route.ts',
    'apps/frontend/app/api/v1/share/track-click/route.ts',
    'apps/frontend/app/api/v1/share/metrics/route.ts',
  ]) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.includes('localhost:4000') || src.includes('BACKEND_URL'), `proxy missing backend: ${p}`);
  }
  const flexProxy = readFileSync('apps/frontend/app/api/v1/share/flex-generate/route.ts', 'utf8');
  assert.ok(flexProxy.includes('x-tenant-id'), 'tenant passthrough');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('flex-share.schema') && barrel.includes('FlexShareInputSchema'));
  ok('Parity: module/GQL(no-collision)/SDL/button+hook+entry/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionGenerate();
  await sectionTrack();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase080 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
