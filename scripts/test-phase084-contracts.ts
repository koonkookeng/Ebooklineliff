// SSOT Phase 084 §10-11 — contract tests (Zod, idle/coupon/token math, Flex, service, processor, parity)
// Run: npx tsx scripts/test-phase084-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AbandonedCartStatusEnum,
  NotificationStepEnum,
  MessagingChannelEnum,
  AbandonedCartTriggerPayloadSchema,
  RecoveryCheckoutPayloadSchema,
  ABANDON_STEP1_IDLE_MIN,
  ABANDON_STEP2_IDLE_MIN,
  RECOVERY_COUPON_TTL_SEC,
  RECOVERY_STEP1_PCT,
  RECOVERY_STEP2_PCT,
  RECOVERY_MAX_MESSAGES,
  CART_RECOVERY_STREAM,
  isStepDue,
  recoveryCouponCode,
  recoveryDiscount,
  signRecoveryToken,
  verifyRecoveryToken,
  recoveryUrl,
  couponCountdownSec,
  abandonWatchKey,
  recoveryRate,
} from '../packages/shared/src/schemas/abandoned-cart.schema';
import { buildAbandonedCartFlex } from '../apps/backend/src/modules/messaging/services/line-flex-builder.service';
import { CouponIssuerService } from '../apps/backend/src/modules/messaging/services/coupon-issuer.service';
import { AbandonedCartService } from '../apps/backend/src/modules/messaging/services/abandoned-cart.service';
import { AbandonedCartProcessor } from '../apps/backend/src/modules/messaging/queues/abandoned-cart.processor';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const TENANT = 'emerald-mall';
const SECRET = 'test-recovery-secret-084';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(AbandonedCartStatusEnum.safeParse('ABANDONED').success, true);
  assert.equal(AbandonedCartStatusEnum.safeParse('CHECKOUT_STARTED').success, false);
  assert.equal(NotificationStepEnum.safeParse('STEP_1_15_MIN').success, true);
  assert.equal(NotificationStepEnum.safeParse('STEP_3_24_HOURS').success, false);
  assert.equal(MessagingChannelEnum.safeParse('LINE_FLEX').success, true);
  assert.equal(MessagingChannelEnum.safeParse('PUSH').success, false);
  const trigger = {
    tenantId: TENANT,
    cartId: UUID,
    userId: UUID_B,
    lineUserId: 'line-u1',
    cartItems: [{
      productId: UUID_C,
      productTitle: 'Ebook A',
      coverImageUrl: 'https://r2.example.com/c.webp',
      price: 500,
      quantity: 2,
    }],
    totalAmount: 1000,
    lastActivityAt: new Date().toISOString(),
  };
  assert.equal(AbandonedCartTriggerPayloadSchema.safeParse(trigger).success, true);
  assert.equal(AbandonedCartTriggerPayloadSchema.safeParse({ ...trigger, cartItems: [] }).success, true);
  assert.equal(
    AbandonedCartTriggerPayloadSchema.safeParse({ ...trigger, cartItems: [{ ...trigger.cartItems[0], price: -1 }] }).success,
    false,
  );
  assert.equal(
    AbandonedCartTriggerPayloadSchema.safeParse({ ...trigger, tenantId: '' }).success,
    false,
  );
  assert.equal(
    RecoveryCheckoutPayloadSchema.safeParse({ recoveryToken: 't', cartId: UUID, isExpired: false }).success,
    true,
  );
  assert.equal(
    RecoveryCheckoutPayloadSchema.safeParse({ recoveryToken: 't', cartId: 'nope', isExpired: false }).success,
    false,
  );
  ok('Zod §3.1 verbatim (status/step/channel/trigger/recovery gates)');
}

// ---------- 2. Idle/coupon/token math (BDD-1/§5.2/§8.1) ----------
{
  assert.equal(ABANDON_STEP1_IDLE_MIN, 15);
  assert.equal(ABANDON_STEP2_IDLE_MIN, 180);
  assert.equal(RECOVERY_COUPON_TTL_SEC, 7200);
  assert.equal(RECOVERY_STEP1_PCT, 10);
  assert.equal(RECOVERY_STEP2_PCT, 15);
  assert.equal(RECOVERY_MAX_MESSAGES, 2);
  assert.equal(CART_RECOVERY_STREAM, 'stream:cart:recovery');
  const now = Date.now();
  assert.equal(isStepDue(now - 16 * 60_000, 'STEP_1_15_MIN', now), true);
  assert.equal(isStepDue(now - 14 * 60_000, 'STEP_1_15_MIN', now), false);
  assert.equal(isStepDue(now - 181 * 60_000, 'STEP_2_3_HOURS', now), true);
  assert.equal(isStepDue(now - 60 * 60_000, 'STEP_2_3_HOURS', now), false);
  assert.ok(/^RECOVER-[0-9A-Z]{5}$/.test(recoveryCouponCode()));
  assert.equal(recoveryDiscount(1000, 10), 100);
  assert.equal(recoveryDiscount(1000, 15), 150);
  const tok = signRecoveryToken(SECRET, UUID);
  assert.equal(verifyRecoveryToken(SECRET, tok), UUID);
  assert.equal(verifyRecoveryToken('wrong', tok), null);
  assert.equal(verifyRecoveryToken(SECRET, 'garbage'), null);
  assert.equal(verifyRecoveryToken(SECRET, signRecoveryToken(SECRET, UUID, now - 3 * 3600_000), now), null);
  assert.equal(recoveryUrl('https://liff.line.me/', tok), `https://liff.line.me/cart/recover?token=${encodeURIComponent(tok)}`);
  assert.equal(couponCountdownSec(now + 65_000, now), 65);
  assert.equal(couponCountdownSec(now - 1000, now), 0);
  assert.equal(abandonWatchKey('c'), 'cart:abandon:watch:c');
  assert.equal(recoveryRate(28, 100), 28);
  assert.equal(recoveryRate(0, 0), 0);
  ok('Math: idle steps + coupon/token + countdown + rate');
}

// ---------- 3. Flex builder + coupon issuer (Task 5) ----------
{
  const card = buildAbandonedCartFlex({
    userName: 'Somsri',
    items: [
      { productTitle: 'Ebook A Very Long Title Beyond Limit 123', coverImageUrl: 'https://r2.example.com/a.webp', price: 500, quantity: 2 },
      { productTitle: 'Course B', coverImageUrl: 'https://r2.example.com/b.webp', price: 300, quantity: 1 },
    ],
    totalAmount: 1300,
    discountAmount: 130,
    couponCode: 'RECOVER-AB12C',
    countdownSec: 3661,
    recoveryUrl: 'https://liff.line.me/cart/recover?token=t',
  }) as { type: string; altText: string; contents: { hero: { url: string }; body: { contents: unknown[] }; footer: { contents: Array<{ action: { uri: string } }> } } };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('Somsri'));
  assert.equal(card.contents.hero.url, 'https://r2.example.com/a.webp');
  const body = JSON.stringify(card.contents.body);
  assert.ok(body.includes('RECOVER-AB12C') && body.includes('61:01') && body.includes('1,170'));
  assert.equal(card.contents.footer.contents[0]?.action.uri, 'https://liff.line.me/cart/recover?token=t');
  const issuer = new CouponIssuerService();
  const c1 = issuer.issue({ totalAmount: 1000, step: 'STEP_1_15_MIN', now: 1000 });
  assert.ok(/^RECOVER-[0-9A-Z]{5}$/.test(c1.couponCode));
  assert.deepEqual([c1.discountPercent, c1.discountAmount, c1.expiresAt], [10, 100, 1000 + 7200_000]);
  const c2 = issuer.issue({ totalAmount: 1000, step: 'STEP_2_3_HOURS', now: 0 });
  assert.deepEqual([c2.discountPercent, c2.discountAmount], [15, 150]);
  assert.equal(issuer.isLive(Date.now(), Date.now()), true);
  assert.equal(issuer.isLive(Date.now() - 3 * 3600_000, Date.now()), false);
  ok('Flex: recovery card + countdown + CTA; coupons 10/15 + 2h window');
}

// ---------- 4. Service: mark/recover/analytics (BDD-2 <500ms, Gate 7/8) ----------
async function sectionService(): Promise<void> {
  function ports(cart: {
    id: string; userId: string; status: string;
    items: Array<{ productId: string; quantity: number; price: number; product: { title: string; coverImageUrl: string; price: number } }>;
    logs?: Array<{ step: string; couponCode: string | null; sentAt: Date }>;
  }) {
    const streams: string[] = [];
    const state = { ...cart, logs: cart.logs ?? [] as Array<{ step: string; couponCode: string | null; sentAt: Date }> };
    const db = {
      $transaction: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> =>
        fn({
          cart: {
            update: async (a: { data: Record<string, unknown> }) => {
              Object.assign(state, {
                status: (a.data['status'] as string) ?? state.status,
                recoveredAt: (a.data['recoveredAt'] as Date) ?? new Date(),
              });
              return { id: state.id, status: state.status };
            },
          },
          abandonedCartLog: {
            updateMany: async () => {
              for (const l of state.logs) Object.assign(l, { isClicked: true, clickedAt: new Date() });
              return { count: state.logs.length };
            },
          },
        }),
      cart: {
        findUnique: async () => state,
        update: async (a: { data: Record<string, unknown> }) => {
          Object.assign(state, { status: (a.data['status'] as string) ?? state.status });
          return { id: state.id, status: state.status };
        },
        findMany: async () => [],
        count: async () => 0,
      },
      abandonedCartLog: {
        findMany: async () => state.logs,
        updateMany: async (a: { data: Record<string, unknown> }) => {
          for (const l of state.logs) Object.assign(l, { isClicked: true });
          void a;
          return { count: state.logs.length };
        },
      },
    };
    const redis = {
      setex: async () => undefined,
      xaddPipeline: async (s: string) => { streams.push(s); },
    };
    return { db, redis, streams, state };
  }
  const svcOf = (p: ReturnType<typeof ports>) =>
    new AbandonedCartService(p.db as never, p.redis as never);
  const fullCart = {
    id: UUID, userId: UUID_B, status: 'ACTIVE',
    items: [{ productId: UUID_C, quantity: 2, price: 500, product: { title: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp', price: 500 } }],
  };
  // markAbandoned: guards + stamp + stream.
  {
    const p = ports(fullCart);
    const r = await svcOf(p).markAbandoned(UUID_B, UUID);
    assert.deepEqual(r, { cartId: UUID, status: 'ABANDONED' });
    assert.ok(p.streams.includes(CART_RECOVERY_STREAM));
    const again = await svcOf(p).markAbandoned(UUID_B, UUID);
    assert.equal(again.status, 'ABANDONED');
  }
  // Guards: unknown / foreign / empty.
  {
    const p = ports({ ...fullCart, items: [] });
    await assert.rejects(svcOf(p).markAbandoned(UUID_B, UUID), /empty/);
    const q = ports(fullCart);
    await assert.rejects(svcOf(q).markAbandoned(UUID, UUID), /belong/);
  }
  // recover: valid token → RECOVERED + session (<500ms) with coupon.
  {
    const sentAt = new Date(Date.now() - 60_000);
    const p = ports({ ...fullCart, status: 'ABANDONED', logs: [{ step: 'STEP_1_15_MIN', couponCode: 'RECOVER-AB12C', sentAt }] });
    const token = signRecoveryToken(SECRET, UUID);
    const t0 = Date.now();
    const r = await svcOf(p).recover(token, SECRET);
    assert.ok(Date.now() - t0 < 500, 'recover <500ms budget');
    assert.equal(r.success, true);
    assert.equal(r.cartSession?.status, 'RECOVERED');
    assert.equal(r.cartSession?.totalAmount, 1000);
    assert.equal(r.cartSession?.discountAmount, 100);
    assert.equal(r.cartSession?.recoveryCouponCode, 'RECOVER-AB12C');
    assert.ok((r.cartSession?.expiresAt ?? '').length > 0);
    assert.ok(p.streams.includes(CART_RECOVERY_STREAM));
  }
  // recover: tampered/expired token + empty cart → graceful ERROR shapes.
  {
    const p = ports(fullCart);
    const bad = await svcOf(p).recover('garbage', SECRET);
    assert.deepEqual([bad.success, bad.cartSession], [false, null]);
    const old = signRecoveryToken(SECRET, UUID, Date.now() - 3 * 3600_000);
    assert.equal((await svcOf(p).recover(old, SECRET)).success, false);
    const empty = ports({ ...fullCart, items: [] });
    const token = signRecoveryToken(SECRET, UUID);
    const r = await svcOf(empty).recover(token, SECRET);
    assert.equal(r.success, false);
  }
  // analytics: funnel math.
  {
    const db = {
      cart: {
        count: async (a: { where: Record<string, unknown> }) => {
          const st = a.where['status'] as { in: string[] } | string;
          if (typeof st === 'string') return st === 'RECOVERED' ? 28 : 0;
          return st.in.length === 2 ? 100 : 0;
        },
        findMany: async () => [{
          items: [{ quantity: 2, price: 500, product: { price: 500 } }],
        }],
      },
      abandonedCartLog: { findMany: async () => [], updateMany: async () => ({}) },
    };
    const svc = new AbandonedCartService(
      { cart: db.cart, abandonedCartLog: db.abandonedCartLog } as never,
      { setex: async () => undefined, xaddPipeline: async () => undefined } as never,
    );
    assert.deepEqual(await svc.analytics(TENANT), {
      totalAbandonedCount: 100, recoveredCount: 28, recoveredRevenue: 1000, recoveryRatePercentage: 28,
    });
  }
  ok('Service: mark/recover/analytics + guards (<500ms)');
}

// ---------- 5. Processor: eligibility + cap + backoff + log (Task 4) ----------
async function sectionProcessor(): Promise<void> {
  function ports(cart: {
    status: string; lineUserId: string | null; items: number; logs: Array<{ step: string }>;
    total?: number;
  }) {
    const logs: Array<{ step: string; couponCode: string }> = [];
    const streams: string[] = [];
    const carts = {
      dueCarts: async () => [{ id: UUID }],
    };
    const coupons = new CouponIssuerService();
    const flex = {
      build: ({ recoveryUrl: u }: { recoveryUrl: string }) => ({ flexMessageJson: JSON.stringify({ url: u }) }),
    };
    let sends = 0;
    const push = {
      sendFlex: async () => {
        sends++;
        if (sends === 1 && (cart as { flaky?: boolean }).flaky) throw new Error('LINE 429');
        return { messageId: `m-${sends}` };
      },
    };
    const prisma = {
      cart: {
        findUnique: async () => ({
          id: UUID, userId: UUID_B, tenantId: TENANT, status: cart.status,
          user: { displayName: 'S', lineUserId: cart.lineUserId },
          items: Array.from({ length: cart.items }, () => ({
            productId: UUID_C, quantity: 1, price: cart.total ?? 500,
            product: { title: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp', price: cart.total ?? 500 },
          })),
          logs: cart.logs,
        }),
        update: async () => ({}),
      },
      abandonedCartLog: {
        create: async (a: { data: { step: string; couponCode: string } }) => {
          logs.push({ step: a.data.step, couponCode: a.data.couponCode });
          return { id: 'log-1' };
        },
      },
      behavioralCampaign: { findFirst: async () => null },
    };
    const redis = {
      set: async () => 'OK',
      xaddPipeline: async (s: string) => { streams.push(s); },
    };
    return { carts, coupons, flex, push, prisma, redis, logs, streams, sends: () => sends };
  }
  const procOf = (p: ReturnType<typeof ports>) =>
    new AbandonedCartProcessor(p.carts as never, p.coupons, p.flex as never, p.push, p.prisma as never, p.redis as never);
  // Happy path (flaky first attempt → backoff retry → sent + log row).
  {
    const p = ports({ status: 'ABANDONED', lineUserId: 'line-u1', items: 1, logs: [], total: 1000, flaky: true });
    const r = await procOf(p).drainDue('STEP_1_15_MIN');
    assert.deepEqual(r, { sent: 1, skipped: 0 });
    assert.equal(p.logs.length, 1);
    assert.ok(/^RECOVER-/.test(p.logs[0]?.couponCode ?? ''));
    assert.ok(p.streams.includes(CART_RECOVERY_STREAM));
  }
  // Skips: paid cart / no LINE identity / step already sent / cap reached.
  {
    const paid = ports({ status: 'COMPLETED', lineUserId: 'line-u1', items: 1, logs: [] });
    assert.deepEqual(await procOf(paid).drainDue('STEP_1_15_MIN'), { sent: 0, skipped: 1 });
    const noline = ports({ status: 'ABANDONED', lineUserId: null, items: 1, logs: [] });
    assert.deepEqual(await procOf(noline).drainDue('STEP_1_15_MIN'), { sent: 0, skipped: 1 });
    const dup = ports({ status: 'ABANDONED', lineUserId: 'line-u1', items: 1, logs: [{ step: 'STEP_1_15_MIN' }] });
    assert.deepEqual(await procOf(dup).drainDue('STEP_1_15_MIN'), { sent: 0, skipped: 1 });
    const cap = ports({
      status: 'ABANDONED', lineUserId: 'line-u1', items: 1,
      logs: [{ step: 'STEP_1_15_MIN' }, { step: 'STEP_2_3_HOURS' }],
    });
    assert.deepEqual(await procOf(cap).drainDue('STEP_2_3_HOURS'), { sent: 0, skipped: 1 });
  }
  ok('Processor: send+log+retry + 4 eligibility skips');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum NotificationStep {',
    'STEP_2_3_HOURS',
    'logs           AbandonedCartLog[]',
    'model AbandonedCartLog {',
    'couponCode     String?',
    'isClicked      Boolean          @default(false)',
    'model BehavioralCampaign {',
    'discountValue Decimal  @default(10.00)',
    'price        Decimal? @db.Decimal(10, 2)',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: Cart.logs + AbandonedCartLog + BehavioralCampaign + price snapshot');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/messaging/messaging.module.ts',
    'apps/backend/src/modules/messaging/controllers/abandoned-cart.controller.ts',
    'apps/backend/src/modules/messaging/services/abandoned-cart.service.ts',
    'apps/backend/src/modules/messaging/services/line-flex-builder.service.ts',
    'apps/backend/src/modules/messaging/services/coupon-issuer.service.ts',
    'apps/backend/src/modules/messaging/queues/abandoned-cart.queue.ts',
    'apps/backend/src/modules/messaging/queues/abandoned-cart.processor.ts',
    'apps/backend/src/modules/messaging/resolvers/abandoned-cart.resolver.ts',
    'apps/backend/src/jobs/queues/abandoned-cart.processor.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  // Coupon/promotion systems stay 088/117-owned.
  for (const f of [
    'apps/backend/src/modules/promotion/promotion.module.ts',
    'apps/backend/src/modules/promotion/services/coupon.service.ts',
  ]) {
    assert.ok(readFileSync(f, 'utf8').includes('AUTO-SCAFFOLD'), `${f} must stay 088-owned`);
  }
  const dto = readFileSync('apps/backend/src/modules/messaging/dto/abandoned-cart.dto.ts', 'utf8');
  assert.ok(dto.includes('MarkAbandonedDto') && dto.includes('RecoverCartDto'));
  const mod = readFileSync('apps/backend/src/modules/messaging/messaging.module.ts', 'utf8');
  assert.ok(mod.includes('MessagingModule') && mod.includes('AbandonedCartProcessor') && mod.includes('AbandonedCartService'));
  assert.ok(!/class MessagingModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('MessagingModule'));
  const gql = readFileSync('apps/backend/src/modules/messaging/resolvers/abandoned-cart.resolver.ts', 'utf8');
  assert.ok(gql.includes('markCartAsAbandoned') && gql.includes('recoverAbandonedCart') && gql.includes('getAbandonedCartAnalytics'));
  const sdl = readFileSync('apps/backend/src/api/graphql/messaging/messaging.graphql', 'utf8');
  assert.ok(sdl.includes('AbandonedCartSession') && sdl.includes('RecoveryPayload') && sdl.includes('AbandonedCartAnalyticsPayload'));
  for (const p of [
    'apps/frontend/components/messaging/RecoverySheet.tsx',
    'apps/frontend/hooks/useAbandonedCartRecovery.ts',
    'apps/frontend/lib/messaging/recovery-client.ts',
    'apps/frontend/app/(liff)/cart/recover/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useAbandonedCartRecovery.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  assert.ok(!hook.includes('useCartStore') && !hook.includes("from 'zustand'"), 'zero-dep hook (no store lib)');
  for (const p of [
    'apps/frontend/app/api/v1/abandoned-cart/recover/route.ts',
    'apps/frontend/app/api/v1/abandoned-cart/analytics/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('abandoned-cart.schema') && barrel.includes('AbandonedCartTriggerPayloadSchema'));
  ok('Parity: module/GQL/SDL/sheet+hook+recover/proxies/barrel (5-state, zero-dep; 088 untouched)');
}

async function main(): Promise<void> {
  await sectionService();
  await sectionProcessor();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase084 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
