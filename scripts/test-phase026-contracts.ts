// SSOT Phase 026 §10 — contract tests (Zod, flex, service, attribution, SDL, UI states)
// Run: npx tsx scripts/test-phase026-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ShareTargetTypeEnum,
  ShareStatusEnum,
  ShareContentTypeEnum,
  DynamicFlexShareInputSchema,
  FlexMessagePayloadSchema,
  RecordShareLogInputSchema,
  ShareTargetPickerResultSchema,
  GenerateFlexShareResponseSchema,
  SHARE_REWARD_POINTS,
  REFERRAL_BIND_DAYS,
  SHARE_PREVIEW_MAX_PAGE,
} from '../packages/shared/src/schemas/social-share.schema';
import { FlexMessageBuilderService } from '../apps/backend/src/modules/social-share/services/flex-message-builder.service';
import { SocialShareService } from '../apps/backend/src/modules/social-share/services/social-share.service';
import { ShareAttributionService } from '../apps/backend/src/modules/affiliate/services/share-attribution.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function stubRedis(published: unknown[]): RedisClusterService {
  return {
    publish: async (_s: string, m: string) => { published.push(JSON.parse(m)); },
  } as unknown as RedisClusterService;
}

const demoUser = { id: 'user-a', displayName: 'Member-A', affiliateCode: 'AFF-A123' };
const demoProduct = {
  id: 'prod-1', title: 'E-Book เด็ด', coverImageUrl: 'https://r2.example.com/c.webp',
  price: 299, discountPrice: 199,
};

// ---------- 1. Zod vocabulary + boundaries (§3.1 Gate 1) ----------
{
  for (const t of ['INDIVIDUAL', 'GROUP', 'ROOM', 'EXTERNAL_URL']) assert.equal(ShareTargetTypeEnum.safeParse(t).success, true);
  assert.equal(ShareTargetTypeEnum.safeParse('CHANNEL').success, false);
  for (const c of ['EBOOK_PAGE', 'EBOOK_SUMMARY', 'COURSE_LESSON', 'CERTIFICATE', 'PRODUCT_BUNDLE']) {
    assert.equal(ShareContentTypeEnum.safeParse(c).success, true);
  }
  for (const s of ['SUCCESS', 'CANCELLED', 'FAILED']) assert.equal(ShareStatusEnum.safeParse(s).success, true);
  assert.equal(DynamicFlexShareInputSchema.safeParse({ productId: 'p1', contentType: 'EBOOK_PAGE' }).success, true);
  assert.equal(DynamicFlexShareInputSchema.safeParse({ productId: '', contentType: 'EBOOK_PAGE' }).success, false);
  assert.equal(DynamicFlexShareInputSchema.safeParse({ productId: 'p1', contentType: 'MOVIE' }).success, false);
  assert.equal(DynamicFlexShareInputSchema.safeParse({ productId: 'p1', contentType: 'EBOOK_PAGE', customQuote: 'x'.repeat(101) }).success, false);
  assert.equal(FlexMessagePayloadSchema.safeParse({ type: 'flex', altText: 'hi', contents: { type: 'bubble' } }).success, true);
  assert.equal(RecordShareLogInputSchema.safeParse({ productId: 'p1', targetType: 'GROUP', status: 'SUCCESS', shareToken: 'SR-X' }).success, true);
  assert.equal(RecordShareLogInputSchema.safeParse({ productId: 'p1', targetType: 'GROUP', status: 'SENT', shareToken: 'SR-X' }).success, false);
  const r = ShareTargetPickerResultSchema.safeParse({ success: true, message: 'ok' });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.rewardPointsEarned, 0);
  assert.equal(SHARE_REWARD_POINTS, 5);
  assert.equal(REFERRAL_BIND_DAYS, 30);
  assert.equal(SHARE_PREVIEW_MAX_PAGE, 10);
  ok('Enums + input/payload/log/result boundaries + viral constants');
}

// ---------- 2. Flex builder: bubble, pricing, tenant accent (Gate 1/6) ----------
{
  const builder = new FlexMessageBuilderService();
  const out = builder.buildProductFlexBubble({
    productTitle: demoProduct.title,
    coverImageUrl: demoProduct.coverImageUrl,
    price: 299,
    discountPrice: 199,
    referrerName: 'Member-A',
    deepLinkUrl: 'https://liff.example.com/share/preview?st=SR-X',
    contentType: 'EBOOK_PAGE',
    pageNumber: 15,
  });
  assert.equal(out.type, 'flex');
  assert.ok(out.altText.includes('Member-A'));
  const bubble = out.contents as { hero: { url: string }; footer: { contents: Array<{ action: { uri: string } }> } };
  assert.equal(bubble.hero.url, demoProduct.coverImageUrl);
  assert.ok(bubble.footer.contents[0].action.uri.includes('st=SR-X'));
  const noDiscount = builder.buildProductFlexBubble({
    productTitle: 'T', coverImageUrl: 'https://r2.example.com/c.webp', price: 100,
    referrerName: 'R', deepLinkUrl: 'https://x.example/', contentType: 'PRODUCT_BUNDLE', tenantColor: '#123456',
  });
  assert.ok(JSON.stringify(noDiscount.contents).includes('#123456'));
  ok('Bubble carries R2 art, deep link CTA, discount strike + tenant accent');
}

function sharePrisma(over: Record<string, unknown> = {}): PrismaService {
  const tx = {
    user: { update: async () => ({}) },
    shareLog: { create: async (args: { data: Record<string, unknown> }) => ({ id: 'log-1', ...args.data }) },
  };
  return {
    user: { findUnique: async () => demoUser },
    product: { findUnique: async () => demoProduct },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    shareLog: {
      findUnique: async () => null,
      update: async () => ({}),
    },
    ...over,
  } as unknown as PrismaService;
}

async function main(): Promise<void> {
// ---------- 3. generateFlexSharePayload: happy + 404s + 400 ----------
{
  const published: unknown[] = [];
  const svc = new SocialShareService(sharePrisma(), new FlexMessageBuilderService(), stubRedis(published));
  const out = await svc.generateFlexSharePayload('user-a', { productId: 'prod-1', contentType: 'EBOOK_PAGE', targetPageNumber: 15 });
  assert.equal(GenerateFlexShareResponseSchema.safeParse(out).success, true);
  assert.ok(out.shareToken.startsWith('SR-'));
  assert.ok(out.deepLinkUrl.includes('ref=AFF-A123') && out.deepLinkUrl.includes(`st=${out.shareToken}`));
  assert.equal(out.affiliateCode, 'AFF-A123');
  const noUser = new SocialShareService(
    sharePrisma({ user: { findUnique: async () => null } }), new FlexMessageBuilderService(), stubRedis([]),
  );
  await assert.rejects(() => noUser.generateFlexSharePayload('ghost', { productId: 'p', contentType: 'EBOOK_PAGE' }), /User not found/);
  const noProduct = new SocialShareService(
    sharePrisma({ product: { findUnique: async () => null } }), new FlexMessageBuilderService(), stubRedis([]),
  );
  await assert.rejects(() => noProduct.generateFlexSharePayload('user-a', { productId: 'ghost', contentType: 'EBOOK_PAGE' }), /Product not found/);
  await assert.rejects(() => svc.generateFlexSharePayload('user-a', { productId: '', contentType: 'EBOOK_PAGE' }), /Invalid share input/);
  ok('Generate: token/deepLink/affiliate wired; 404 user/product; 400 bad input');
}

// ---------- 4. recordShareLog: SUCCESS +5 atomic, CANCELLED 0, P2002→400 ----------
{
  const published: unknown[] = [];
  let points = 0;
  const tx = {
    user: { update: async (args: { data: { rewardPoints: { increment: number } } }) => { points += args.data.rewardPoints.increment; } },
    shareLog: { create: async (args: { data: Record<string, unknown> }) => ({ id: 'log-9', ...args.data }) },
  };
  const svc = new SocialShareService(
    { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaService,
    new FlexMessageBuilderService(), stubRedis(published),
  );
  const good = await svc.recordShareLog('user-a', { productId: 'prod-1', targetType: 'INDIVIDUAL', status: 'SUCCESS', shareToken: 'SR-1' });
  assert.equal(good.success, true);
  assert.equal(good.rewardPointsEarned, 5);
  assert.equal(points, 5);
  assert.equal((published[0] as { event: string }).event, 'share.logged');
  const cancelled = await svc.recordShareLog('user-a', { productId: 'prod-1', targetType: 'GROUP', status: 'CANCELLED', shareToken: 'SR-2' });
  assert.equal(cancelled.rewardPointsEarned, 0);
  assert.equal(points, 5);
  assert.equal(published.length, 1);
  const dupe = new SocialShareService(
    {
      $transaction: async () => { const e = new Error('Unique') as Error & { code?: string }; e.code = 'P2002'; throw e; },
    } as unknown as PrismaService,
    new FlexMessageBuilderService(), stubRedis([]),
  );
  await assert.rejects(() => dupe.recordShareLog('user-a', { productId: 'p', targetType: 'INDIVIDUAL', status: 'SUCCESS', shareToken: 'SR-1' }), /already recorded/);
  await assert.rejects(() => svc.recordShareLog('user-a', { productId: 'p', targetType: 'NOPE', status: 'SUCCESS', shareToken: 'SR-3' }), /Invalid share-log/);
  ok('Log: SUCCESS +5 atomic + stream; CANCELLED silent; dupe 400; bad enum 400');
}

// ---------- 5. trackShareClick: counters + event; unknown → null ----------
{
  const published: unknown[] = [];
  let clicks = 0;
  const svc = new SocialShareService(
    {
      shareLog: {
        findUnique: async (args: { where: { shareToken: string } }) =>
          args.where.shareToken === 'SR-1'
            ? { id: 'log-1', product: { id: 'prod-1', title: 'T', productType: 'EBOOK', coverImageUrl: 'https://r2.example.com/c.webp' } }
            : null,
        update: async () => { clicks++; return {}; },
      },
    } as unknown as PrismaService,
    new FlexMessageBuilderService(), stubRedis(published),
  );
  const hit = await svc.trackShareClick('SR-1');
  assert.equal(hit?.productId, 'prod-1');
  assert.equal(clicks, 1);
  assert.equal((published[0] as { event: string }).event, 'share.clicked');
  const miss = await svc.trackShareClick('SR-NOPE');
  assert.equal(miss, null);
  ok('Click: preview payload + counter + K-factor event; unknown token null');
}

// ---------- 6. Attribution: bind window/dedupe + commission idempotent ----------
{
  const published: unknown[] = [];
  const freshLog = { id: 'log-1', createdAt: new Date() };
  const oldLog = { id: 'log-2', createdAt: new Date(Date.now() - 31 * 864e5) };
  const binds = new Map<string, { id: string; shareLogId: string; referredUserId: string }>();
  const prisma = {
    shareLog: {
      findUnique: async (args: { where: { shareToken: string } }) =>
        args.where.shareToken === 'SR-OLD' ? oldLog : args.where.shareToken === 'SR-1' ? freshLog : null,
      update: async () => ({}),
    },
    viralAttribution: {
      findFirst: async (args: { where: { shareLogId?: string; referredUserId?: string; orderId?: string | null } }) => {
        if (args.where.orderId === null) {
          for (const b of binds.values()) if (b.referredUserId === args.where.referredUserId) return { ...b, orderId: null };
          return null;
        }
        for (const b of binds.values()) {
          if ((!args.where.shareLogId || b.shareLogId === args.where.shareLogId) && b.referredUserId === args.where.referredUserId) return b;
        }
        return null;
      },
      create: async (args: { data: { shareLogId: string; referredUserId: string } }) => {
        const row = { id: `va-${binds.size + 1}`, ...args.data };
        binds.set(row.id, row);
        return row;
      },
      update: async (args: { where: { id: string }; data: { orderId: string; commissionAmt: number } }) => ({ id: args.where.id, ...args.data }),
      findUnique: async () => ({ id: 'va-1', orderId: 'ORD-1' }),
    },
  } as unknown as PrismaService;
  const svc = new ShareAttributionService(prisma, stubRedis(published));
  const bound = await svc.bindReferral('SR-1', 'friend-b');
  assert.ok(bound && 'id' in (bound as object));
  const dup = await svc.bindReferral('SR-1', 'friend-b');
  assert.equal((dup as { id: string }).id, (bound as { id: string }).id);
  assert.equal(binds.size, 1);
  assert.equal(await svc.bindReferral('SR-OLD', 'friend-c'), null);
  assert.equal(await svc.bindReferral('SR-NOPE', 'friend-d'), null);
  const credited = await svc.creditOrderCommission('ORD-1', 'friend-b', 29.9);
  assert.equal((credited as { orderId: string }).orderId, 'ORD-1');
  assert.equal(await svc.creditOrderCommission('ORD-9', 'stranger', 10), null);
  const events = published.map((p) => (p as { event: string }).event);
  assert.ok(events.includes('share.referral-bound') && events.includes('share.converted'));
  ok('Bind: 30-day window + dedupe; commission idempotent + conversion counted');
}

// ---------- 7. SDL + wiring + 5-state UI + overlays + preview + PDP ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/share.graphql/schema.graphql', 'utf8');
  for (const t of [...ShareTargetTypeEnum.options, ...ShareContentTypeEnum.options]) assert.ok(sdl.includes(t), `SDL missing ${t}`);
  assert.ok(sdl.includes('generateProductFlexShare') && sdl.includes('recordShareLog'));
  const mod = readFileSync('apps/backend/src/modules/social-share/social-share.module.ts', 'utf8');
  assert.ok(mod.includes('SocialShareService') && mod.includes('ShareAttributionService'));
  const hook = readFileSync('apps/frontend/hooks/useLineShareTargetPicker.ts', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) assert.ok(hook.includes(s), `hook missing ${s}`);
  assert.ok(hook.includes('isApiAvailable') && hook.includes('clipboard'));
  const btn = readFileSync('apps/frontend/components/share/NativeActionButton.tsx', 'utf8');
  assert.ok(btn.includes("'floating'") && btn.includes("'inline'") && btn.includes('disabled'));
  assert.ok(!btn.includes("from 'lucide") && !btn.includes('from "lucide'), 'zero new deps: no lucide import');
  for (const [f, marker] of [
    ['apps/frontend/components/reader/CanvasReaderOverlay.tsx', 'EBOOK_PAGE'],
    ['apps/frontend/components/player/HLSPlayerOverlay.tsx', 'COURSE_LESSON'],
    ['apps/frontend/app/(liff)/share/preview/page.tsx', 'SHARE_PREVIEW_MAX_PAGE'],
    ['apps/frontend/components/pdp/ProductDetailPage.tsx', 'shareSlot'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/api/v1/social-share/preview'"));
  ok('SDL/code-first parity; module exports attribution; UI 5-state + overlays + preview + PDP slot');
}

console.log(`\nPhase 026 contracts: ${passed} checks passed`);
}

void main();
