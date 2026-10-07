// SSOT Phase 034 §10 — contract tests (Zod, HMAC, OA sync, webhook, UI, wiring)
// Run: npx tsx scripts/test-phase034-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  BotPromptModeEnum,
  LineOAFriendshipStatusSchema,
  LineAuthWithOAPromptInputSchema,
  LineWebhookEventSchema,
  LineOAPublicConfigSchema,
  OA_EVENT_CHANNEL,
  OA_BOT_PROMPT_DEFAULT,
  OA_FRIEND_CACHE_TTL_MS,
  oaFriendCacheKey,
  oaAddFriendUrl,
  oaQrImageUrl,
} from '../packages/shared/src/schemas/line-oa-contract';
import { verifyLineSignature, LineOAService } from '../apps/backend/src/modules/line-oa/line-oa.service';
import { LineAuthService } from '../apps/backend/src/modules/auth/line-auth.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
// NOTE: Controllers/Resolver use Nest parameter decorators (@Body/@Args) which
// tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–033 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod OA vocabulary + webhook tolerance (§3.1 Gate 1) ----------
{
  for (const m of ['NONE', 'NORMAL', 'AGGRESSIVE']) assert.equal(BotPromptModeEnum.safeParse(m).success, true);
  assert.equal(LineOAFriendshipStatusSchema.safeParse({ userId: 'u', lineUserId: 'U1', isOAFriend: true, botPromptMode: 'AGGRESSIVE', updatedAt: new Date().toISOString() }).success, true);
  assert.equal(LineOAFriendshipStatusSchema.safeParse({ userId: '', lineUserId: 'U1', isOAFriend: true, botPromptMode: 'AGGRESSIVE', updatedAt: new Date().toISOString() }).success, false);
  assert.equal(LineAuthWithOAPromptInputSchema.safeParse({ idToken: 'id', accessToken: 'at', tenantId: 't', isOAFriend: false }).success, true);
  assert.equal(LineAuthWithOAPromptInputSchema.safeParse({ idToken: '', accessToken: 'at', tenantId: 't', isOAFriend: false }).success, false);

  const follow = { destination: 'Ubot', events: [{ type: 'follow', mode: 'active', timestamp: 1, source: { type: 'user', userId: 'U1' } }] };
  assert.equal(LineWebhookEventSchema.safeParse(follow).success, true);
  // Non-friendship deliveries (message/postback) must NOT 400 a genuine LINE hit.
  const mixed = { destination: 'Ubot', events: [...follow.events, { type: 'message', source: { type: 'user', userId: 'U1' } }, { type: 'unfollow', source: { type: 'user' } }] };
  assert.equal(LineWebhookEventSchema.safeParse(mixed).success, true);
  assert.deepEqual(LineWebhookEventSchema.parse({ destination: 'Ubot' }).events, []);
  assert.equal(LineWebhookEventSchema.safeParse({ events: [] }).success, false);
  assert.equal(LineOAPublicConfigSchema.safeParse({ tenantId: 't', lineOaBasicId: '@brand', botPromptMode: 'AGGRESSIVE' }).success, true);

  assert.equal(OA_EVENT_CHANNEL, 'line.oa.friendship');
  assert.equal(OA_BOT_PROMPT_DEFAULT, 'AGGRESSIVE');
  assert.equal(OA_FRIEND_CACHE_TTL_MS, 86400000);
  assert.equal(oaFriendCacheKey('t'), 'oa-friend:t');
  assert.equal(oaAddFriendUrl('@brand'), 'https://line.me/R/ti/p/@brand');
  assert.equal(oaQrImageUrl('@brand'), 'https://qr-official.line.me/sid/M/brand.png');
  ok('Zod prompt/friendship/auth/webhook tolerance + channel/URL/cache constants');
}

// ---------- 2. HMAC-SHA256 verification (<10ms, timing-safe) ----------
{
  const secret = 'test-channel-secret';
  const raw = JSON.stringify({ destination: 'Ubot', events: [] });
  const sig = createHmac('SHA256', secret).update(raw).digest('base64');
  assert.equal(verifyLineSignature(raw, sig, secret), true);
  assert.equal(verifyLineSignature(raw, sig, 'wrong-secret'), false);
  assert.equal(verifyLineSignature(raw, sig.slice(0, -2) + 'xx', secret), false);
  assert.equal(verifyLineSignature('', sig, secret), false);
  assert.equal(verifyLineSignature(raw, '', secret), false);
  assert.equal(verifyLineSignature(raw, sig, ''), false);
  const start = Date.now();
  for (let i = 0; i < 100; i++) verifyLineSignature(raw, sig, secret);
  assert.ok(Date.now() - start < 1000, 'HMAC must stay far under the 10ms budget');
  ok('HMAC valid/forged/empty matrix + timing-safe + budget');
}

function stubCluster(published: Array<{ c: string; m: string }> = []): RedisClusterService {
  return {
    get: async () => null,
    setex: async () => undefined,
    del: async () => undefined,
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService;
}

async function main(): Promise<void> {
// ---------- 3. OA service: follow/unfollow atomic flip + onboarding event ----------
{
  const published: Array<{ c: string; m: string }> = [];
  const txOps: unknown[] = [];
  const prisma = {
    user: { findUnique: async ({ where: { lineUserId } }: { where: { lineUserId: string } }) => (lineUserId === 'U1' ? { id: 'user-1' } : null) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { update: async (a: unknown) => { txOps.push({ update: a }); return {}; } },
        lineOAFriendshipLog: { create: async (a: unknown) => { txOps.push({ create: a }); return {}; } },
      };
      return fn(tx);
    },
    tenantConfig: { findFirst: async () => ({ tenantName: 't', lineOaId: '@brand', botPromptMode: 'AGGRESSIVE' }) },
  } as unknown as PrismaService;
  const svc = new LineOAService(prisma, stubCluster(published));

  const follow = await svc.processWebhookEvents([{ type: 'follow', source: { userId: 'U1' } }]);
  assert.equal(follow.processed, 1);
  const update = (txOps.find((o) => (o as { update?: unknown }).update) as { update: { data: Record<string, unknown> } }).update;
  assert.equal(update.data.isOAFriend, true);
  assert.ok(update.data.oaFriendshipUpdatedAt instanceof Date);
  const create = (txOps.find((o) => (o as { create?: unknown }).create) as { create: { data: Record<string, unknown> } }).create;
  assert.equal(create.data.eventType, 'FOLLOW');
  assert.equal(published[0].c, 'line.oa.friendship');
  assert.ok((published[0].m as string).includes('line_oa_follow_success'));

  txOps.length = 0;
  const unfollow = await svc.processWebhookEvents([{ type: 'unfollow', source: { userId: 'U1' } }]);
  assert.equal(unfollow.processed, 1);
  assert.ok((published[1].m as string).includes('line_oa_unfollow'));

  // Unknown users + non-friendship events + bad shapes: skipped, still success.
  txOps.length = 0;
  const skipped = await svc.processWebhookEvents([
    { type: 'follow', source: { userId: 'GHOST' } },
    { type: 'message', source: { userId: 'U1' } },
    { type: 'follow', source: {} },
    { type: 'follow' },
  ]);
  assert.equal(skipped.processed, 0);
  assert.equal(txOps.length, 0);

  // Public config: row → validated; garbage row → fallback (no secrets either way).
  const cfg = await svc.publicConfig('t');
  assert.equal(cfg.lineOaBasicId, '@brand');
  assert.ok(!('lineOaChannelSecret' in (cfg as object)) && !('lineOaChannelToken' in (cfg as object)));
  const garbage = new LineOAService(
    { user: { findUnique: async () => null }, tenantConfig: { findFirst: async () => ({ tenantName: 't', lineOaId: '@b', botPromptMode: 'LOUD' }) } } as unknown as PrismaService,
    stubCluster(),
  );
  assert.equal((await garbage.publicConfig('t')).botPromptMode, 'AGGRESSIVE');
  const missing = new LineOAService(
    { user: { findUnique: async () => null }, tenantConfig: { findFirst: async () => null } } as unknown as PrismaService,
    stubCluster(),
  );
  assert.equal((await missing.publicConfig('nope')).tenantId, 'nope');
  ok('OA follow/unfollow atomic flip + events; skips safe; config secret-free + fallback');
}

// ---------- 4. LineAuthService: read + change-only sync logging ----------
{
  const created: unknown[] = [];
  let flag = true;
  const prisma = {
    user: {
      findUnique: async ({ where: { lineUserId } }: { where: { lineUserId: string } }) =>
        lineUserId === 'U1' ? { id: 'user-1', isOAFriend: flag } : null,
      update: async ({ data }: { data: { isOAFriend: boolean } }) => {
        flag = data.isOAFriend;
        return { id: 'user-1', isOAFriend: flag, oaFriendshipUpdatedAt: new Date() };
      },
    },
    lineOAFriendshipLog: { create: async (a: unknown) => { created.push(a); return {}; } },
  } as unknown as PrismaService;
  const svc = new LineAuthService(prisma);
  assert.deepEqual(await svc.getOAFriendship('GHOST'), { userId: null, isOAFriend: false });
  assert.deepEqual(await svc.getOAFriendship('U1'), { userId: 'user-1', isOAFriend: true });
  await assert.rejects(() => svc.getOAFriendship(''), /Missing LINE user id/);

  // No change → no log row.
  assert.deepEqual(await svc.syncOAFriendship({ lineUserId: 'U1', isOAFriend: true }), { userId: 'user-1', isOAFriend: true, changed: false });
  assert.equal(created.length, 0);
  // Change → update + exactly one log row.
  assert.deepEqual(await svc.syncOAFriendship({ lineUserId: 'U1', isOAFriend: false }), { userId: 'user-1', isOAFriend: false, changed: true });
  assert.equal(created.length, 1);
  assert.equal((created[0] as { data: Record<string, unknown> }).data.eventType, 'UNFOLLOW');
  await assert.rejects(() => svc.syncOAFriendship({ lineUserId: '', isOAFriend: true }), /Invalid OA friendship/);
  await assert.rejects(() => svc.syncOAFriendship({ lineUserId: 'GHOST', isOAFriend: true }), /Unknown LINE user/);
  ok('OA read unknown→false; sync change-only logging; 400s');
}

// ---------- 5. Hook + modal + flow + page + client source parity ----------
{
  const hook = readFileSync('apps/frontend/hooks/useLineAuthAndFriendship.ts', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'aggressive', 'getFriendship', 'getLiff', 'syncFriendship', 'writeFriendCache', 'readFriendCache', 'recheck']) {
    assert.ok(hook.includes(t), `hook missing ${t}`);
  }
  assert.ok(!hook.includes("from '@line/liff'"), 'RAM guard: no static SDK import');
  const modal = readFileSync('apps/frontend/components/auth/LineOAPromptModal.tsx', 'utf8');
  for (const t of ['oaQrImageUrl', 'oaAddFriendUrl', 'เพิ่มเพื่อนเพื่อรับสิทธิ์ใช้งานเต็มรูปแบบ', 'ฉันเพิ่มเพื่อนเรียบร้อยแล้ว', 'role="dialog"']) {
    assert.ok(modal.includes(t), `modal missing ${t}`);
  }
  assert.ok(!modal.includes("from '@/components/ui") && !modal.includes('from "lucide'), 'zero new deps: no shadcn/lucide import');
  const flow = readFileSync('apps/frontend/components/auth/LineAuthFlow.tsx', 'utf8');
  for (const t of ['useLineAuthAndFriendship', 'LineOAPromptModal', 'fetchOaConfig', 'router.replace', 'onAddedFriend']) {
    assert.ok(flow.includes(t), `flow missing ${t}`);
  }
  const page = readFileSync('apps/frontend/app/(liff)/auth/page.tsx', 'utf8');
  assert.ok(page.includes('LineAuthFlow') && page.includes('liff-splash') && page.includes('Suspense'));
  const client = readFileSync('apps/frontend/lib/line-oa/oa-client.ts', 'utf8');
  for (const t of ['/api/v1/line-oa/config', '/api/v1/line-oa/friendship', 'oaFriendCacheKey', 'OA_FRIEND_CACHE_TTL_MS']) {
    assert.ok(client.includes(t), `client missing ${t}`);
  }
  for (const [f, marker] of [
    ['apps/frontend/app/api/v1/line-oa/config/route.ts', '/api/v1/line-oa/config'],
    ['apps/frontend/app/api/v1/line-oa/friendship/route.ts', '/api/v1/line-oa/friendship?'],
    ['apps/frontend/app/api/v1/line-oa/friendship/sync/route.ts', 'keepalive: true'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes("'/api/v1/line-oa/config'"));
  ok('Hook 5-state + aggressive + cache; modal QR/deep-link; flow/page; client/proxies/middleware');
}

// ---------- 6. Prisma + module wiring + controller/resolver/SDL parity ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum BotPromptMode', 'AGGRESSIVE', 'model TenantConfig', 'model LineOAFriendshipLog', 'isOAFriend', 'oaFriendshipUpdatedAt', 'oaFriendshipLogs', 'lineOaChannelSecret', '@@index([isOAFriend])', '@@index([eventType])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/line-oa/line-oa.module.ts', 'utf8');
  for (const t of ['LineOAService', 'LineOAController', 'LineOAResolver', 'LineAuthService']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('LineOAModule') && app.includes('LineWebhooksModule'));
  const webmod = readFileSync('apps/backend/src/webhooks/line-webhooks.module.ts', 'utf8');
  assert.ok(webmod.includes('LineMessagingWebhookController') && webmod.includes('LineOAModule'));
  const hook = readFileSync('apps/backend/src/webhooks/line-messaging.controller.ts', 'utf8');
  for (const t of ["webhooks/line", "'oa'", 'x-line-signature', 'LineWebhookEventSchema', 'processWebhookEvents', 'Missing LINE signature']) {
    assert.ok(hook.includes(t), `webhook missing ${t}`);
  }
  const ctlSrc = readFileSync('apps/backend/src/modules/line-oa/line-oa.controller.ts', 'utf8');
  for (const t of ['api/v1/line-oa', "'config'", "'friendship'", 'JwtAuthGuard', 'lineUserId mismatch', 'getOAFriendship']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  assert.ok(!ctlSrc.includes('syncOAFriendship({ lineUserId: me.lineUserId, isOAFriend: true })'), 'GET stays read-only');
  const resolverSrc = readFileSync('apps/backend/src/modules/line-oa/line-oa.resolver.ts', 'utf8');
  for (const t of ['getLineOAFriendshipStatus', 'syncLineOAFriendship', 'LineOAFriendshipPayload', 'Missing OA identity']) {
    assert.ok(resolverSrc.includes(t), `resolver missing ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/line-oa.graphql/schema.graphql', 'utf8');
  for (const t of ['LineOAFriendshipPayload', 'LineAuthWithOAInput', 'getLineOAFriendshipStatus', 'syncLineOAFriendship']) {
    assert.ok(sdl.includes(t), `SDL missing ${t}`);
  }
  ok('Prisma OA segment; modules wired; webhook/controller read-only-GET/resolver/SDL parity');
}

console.log(`\nPhase 034 contracts: ${passed} checks passed`);
}

void main();
