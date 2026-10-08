// SSOT Phase 056 §10 — contract tests (Zod, router service, wiring, RAM guard)
// Run: npx tsx scripts/test-phase056-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RuntimeEnvironmentEnum,
  ViewportCapabilitiesSchema,
  ViewportStateSyncSchema,
  ViewportStateSyncInputSchema,
  ViewportConfigPayloadSchema,
  VIEWPORT_LIFF_RAM_MB,
  VIEWPORT_WEB_RAM_MB,
  VIEWPORT_DESKTOP_BREAKPOINT_PX,
  VIEWPORT_WATERMARK_REFRESH_SEC,
  VIEWPORT_SESSION_TTL_SEC,
  VIEWPORT_LIFF_FALLBACK_MS,
  detectRuntimeEnvironment,
  ramBudgetFor,
  viewportSlidingWindowPages,
  viewportSessionKey,
  watermarkTextFor,
  isLiffEnvironment,
} from '../packages/shared/src/schemas/viewport-contract';
import {
  ViewportRouterService,
  watermarkSignature,
} from '../apps/backend/src/modules/viewport/viewport.service';
// NOTE: Resolver/Controller/Module carry Nest (parameter) decorators which
// tsx/esbuild cannot transform — verified via static source parity (§6)
// following the Phase 027–055 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174000';

function makeService(entitled = true) {
  const sets: Array<{ key: string; ttl: number }> = [];
  const svc = new ViewportRouterService(
    { hasEntitlement: async () => entitled },
    { displayNameOf: async () => 'Test User' },
    {
      set: async (key: string, _v: string, ttl: number) => {
        sets.push({ key, ttl });
      },
    },
    { recordSync: async () => undefined },
  );
  return { svc, sets };
}

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + routing policy ----------
{
  assert.equal(RuntimeEnvironmentEnum.safeParse('LINE_LIFF_MOBILE').success, true);
  assert.equal(RuntimeEnvironmentEnum.safeParse('WEB_DESKTOP_WORKSPACE').success, true);
  assert.equal(RuntimeEnvironmentEnum.safeParse('NATIVE_APP').success, false);

  const caps = ViewportCapabilitiesSchema.parse({
    environment: 'LINE_LIFF_MOBILE',
    isLiff: true,
    screenWidth: 390,
    screenHeight: 844,
    devicePixelRatio: 3,
    supportsTouch: true,
  });
  assert.equal(caps.maxRamBudgetMB, 30);
  assert.equal(ViewportCapabilitiesSchema.safeParse({ ...caps, screenWidth: -1 }).success, false);

  const sync = ViewportStateSyncSchema.parse({
    productId: PRODUCT_ID,
    contentType: 'EBOOK',
    lastPageNumber: 7,
    viewportMode: 'LINE_LIFF_MOBILE',
    timestamp: new Date().toISOString(),
  });
  assert.equal(sync.lastPageNumber, 7);
  assert.equal(ViewportStateSyncSchema.safeParse({ ...sync, productId: 'nope' }).success, false);
  assert.equal(ViewportStateSyncInputSchema.safeParse({
    productId: PRODUCT_ID, contentType: 'COURSE_VIDEO', lastWatchedSec: 120, viewportMode: 'WEB_DESKTOP_WORKSPACE',
  }).success, true);

  assert.equal(VIEWPORT_LIFF_RAM_MB, 30);
  assert.equal(VIEWPORT_WEB_RAM_MB, 512);
  assert.equal(VIEWPORT_DESKTOP_BREAKPOINT_PX, 1024);
  assert.equal(VIEWPORT_WATERMARK_REFRESH_SEC, 15);
  assert.equal(VIEWPORT_SESSION_TTL_SEC, 3600);
  assert.equal(VIEWPORT_LIFF_FALLBACK_MS, 500);

  // BDD Scenario 1: LINE Webview → LIFF mobile; Scenario 2: desktop → workspace.
  assert.equal(detectRuntimeEnvironment(true, 390), 'LINE_LIFF_MOBILE');
  assert.equal(detectRuntimeEnvironment(true, 1280), 'LINE_LIFF_DESKTOP');
  assert.equal(detectRuntimeEnvironment(false, 390), 'WEB_MOBILE_PWA');
  assert.equal(detectRuntimeEnvironment(false, 1280), 'WEB_DESKTOP_WORKSPACE');
  assert.equal(ramBudgetFor(true), 30);
  assert.equal(ramBudgetFor(false), 512);
  assert.deepEqual(viewportSlidingWindowPages(5, true), [4, 5, 6]);
  assert.deepEqual(viewportSlidingWindowPages(5, false), [3, 4, 5, 6, 7]);
  assert.deepEqual(viewportSlidingWindowPages(1, true), [1, 2]);
  assert.equal(viewportSessionKey(USER_ID, PRODUCT_ID), `viewport:session:${USER_ID}:${PRODUCT_ID}`);
  assert.ok(watermarkTextFor('Test User', USER_ID).includes('Test User'));
  assert.ok(watermarkTextFor('Test User', USER_ID).includes(USER_ID.slice(0, 8)));
  assert.equal(isLiffEnvironment('LINE_LIFF_MOBILE'), true);
  assert.equal(isLiffEnvironment('WEB_DESKTOP_WORKSPACE'), false);
  ok('Zod viewport contracts verbatim + detect/budget/window/key/watermark policy');
}

// ---------- 2. Router service: entitlement gate + budgets + watermark + cache ----------
async function sectionService(): Promise<void> {
  const { svc, sets } = makeService(true);
  const out = await svc.resolveViewportConfig(USER_ID, PRODUCT_ID, {
    environment: 'LINE_LIFF_MOBILE',
    isLiff: true,
    screenWidth: 390,
    screenHeight: 844,
    devicePixelRatio: 3,
    maxRamBudgetMB: 30,
    supportsTouch: true,
  });
  assert.equal(ViewportConfigPayloadSchema.safeParse(out).success, true);
  assert.equal(out.recommendedMode, 'LINE_LIFF_MOBILE');
  assert.equal(out.maxMemoryLimitMB, 30);
  assert.ok(out.watermarkConfig.watermarkText.includes('Test User'));
  assert.equal(out.watermarkConfig.refreshIntervalSec, 15);
  assert.equal(out.watermarkConfig.hashSignature, watermarkSignature(USER_ID, PRODUCT_ID));
  assert.equal(sets.length, 1);
  assert.equal(sets[0].key, viewportSessionKey(USER_ID, PRODUCT_ID));
  assert.equal(sets[0].ttl, VIEWPORT_SESSION_TTL_SEC);

  const web = await svc.resolveViewportConfig(USER_ID, PRODUCT_ID, {
    environment: 'WEB_DESKTOP_WORKSPACE',
    isLiff: false,
    screenWidth: 1440,
    screenHeight: 900,
    devicePixelRatio: 2,
    maxRamBudgetMB: 512,
    supportsTouch: false,
  });
  assert.equal(web.maxMemoryLimitMB, 512);

  const denied = makeService(false);
  await assert.rejects(
    denied.svc.resolveViewportConfig(USER_ID, PRODUCT_ID, {
      environment: 'WEB_MOBILE_PWA',
      isLiff: false,
      screenWidth: 390,
      screenHeight: 844,
      devicePixelRatio: 2,
      maxRamBudgetMB: 512,
      supportsTouch: true,
    }),
    /entitlement/i,
  );

  const synced = await svc.syncViewportState(USER_ID, {
    productId: PRODUCT_ID,
    contentType: 'EBOOK',
    lastPageNumber: 9,
    viewportMode: 'WEB_DESKTOP_WORKSPACE',
  });
  assert.equal(synced.ok, true);
  assert.ok(typeof synced.syncedAt === 'string');
  await assert.rejects(
    svc.syncViewportState(USER_ID, { productId: 'bad', contentType: 'EBOOK', viewportMode: 'WEB_DESKTOP_WORKSPACE' }),
    /productId|uuid/i,
  );
  ok('Router service: entitlement gate + LIFF 30MB/Web 512MB + watermark + session cache + sync');
}

// ---------- 3. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum RuntimeEnvironment',
    'LINE_LIFF_MOBILE',
    'LINE_LIFF_DESKTOP',
    'WEB_MOBILE_PWA',
    'WEB_DESKTOP_WORKSPACE',
    'model UserDeviceSession',
    'lastViewportMode',
    'RuntimeEnvironment @default(WEB_DESKTOP_WORKSPACE)',
    'deviceUserAgent',
    'lastIpAddress',
    'activeSession',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: RuntimeEnvironment + UserDeviceSession viewport columns (expand-contract)');
}

// ---------- 4. Static parity: backend gateway + GQL/SDL + module wiring ----------
function sectionBackendParity(): void {
  const svc = readFileSync('apps/backend/src/modules/viewport/viewport.service.ts', 'utf8');
  for (const t of ['ViewportRouterService', 'resolveViewportConfig', 'syncViewportState', 'ramBudgetFor', 'viewportSessionKey', 'watermarkSignature', 'VIEWPORT_SESSION_TTL_SEC']) {
    assert.ok(svc.includes(t), `viewport service missing: ${t}`);
  }
  const ctl = readFileSync('apps/backend/src/modules/viewport/viewport.controller.ts', 'utf8');
  for (const t of ['api/v1/viewport', 'config', 'sync', 'ViewportCapabilitiesSchema', 'ViewportStateSyncInputSchema']) {
    assert.ok(ctl.includes(t), `viewport controller missing: ${t}`);
  }
  const gql = readFileSync('apps/backend/src/modules/viewport/viewport.resolver.ts', 'utf8');
  for (const t of ['getUniversalViewportConfig', 'syncUniversalViewportState']) {
    assert.ok(gql.includes(t), `viewport resolver missing: ${t}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/viewport.graphql', 'utf8');
  for (const t of ['getUniversalViewportConfig', 'syncUniversalViewportState', 'ViewportConfigPayload', 'WatermarkConfig', 'ViewportStateSyncInput', 'SyncResponsePayload']) {
    assert.ok(sdl.includes(t), `viewport SDL missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/viewport/viewport.module.ts', 'utf8');
  assert.ok(mod.includes('ViewportModule'));
  assert.ok(mod.includes('ViewportRouterService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ViewportModule'));
  ok('Backend parity: service + REST + GQL + SDL + module + AppModule wiring');
}

// ---------- 5. Static parity: hook + router + reader + player + page + proxies ----------
function sectionFrontendParity(): void {
  const hook = readFileSync('apps/frontend/hooks/useViewportEnvironment.ts', 'utf8');
  for (const t of ['useViewportEnvironment', 'isInClient', 'detectRuntimeEnvironment', 'ramBudgetFor', 'VIEWPORT_LIFF_FALLBACK_MS', 'ERROR_FALLBACK', 'retry']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const router = readFileSync('apps/frontend/components/viewport/UniversalViewportRouter.tsx', 'utf8');
  for (const t of ['UniversalViewportRouter', 'AdaptiveCanvasReader', 'AdaptiveHlsPlayer', '--primary-color', 'กำลังปรับแต่งระบบการแสดงผล', 'เปิดบนเว็บโดยตรง']) {
    assert.ok(router.includes(t), `router missing: ${t}`);
  }
  const reader = readFileSync('apps/frontend/components/reader/AdaptiveCanvasReader.tsx', 'utf8');
  for (const t of ['AdaptiveCanvasReader', 'viewportSlidingWindowPages', 'revokeObjectURL', 'canvas.width = canvas.width', 'USER-VERIFIED', 'ก่อนหน้า', 'ถัดไป', 'ArrowLeft']) {
    assert.ok(reader.includes(t), `reader missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/player/AdaptiveHlsPlayer.tsx', 'utf8');
  for (const t of ['AdaptiveHlsPlayer', '70/30', 'USER-VERIFIED', 'รับชมแล้ว', 'removeAttribute']) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  const page = readFileSync('apps/frontend/app/(web)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(page.includes('UniversalViewportRouter'));
  for (const p of ['apps/frontend/app/api/v1/viewport/config/route.ts', 'apps/frontend/app/api/v1/viewport/sync/route.ts', 'apps/frontend/app/api/v1/viewport/stream/route.ts']) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.includes('/api/v1/viewport') || src.includes('/api/v1/stream'), `${p} missing backend forward`);
  }
  ok('Frontend parity: hook + router + reader + player + web page + 3 proxies');
}

// ---------- 6. RAM guard: no heavy deps in the LIFF path ----------
{
  for (const p of [
    'apps/frontend/hooks/useViewportEnvironment.ts',
    'apps/frontend/components/viewport/UniversalViewportRouter.tsx',
    'apps/frontend/components/reader/AdaptiveCanvasReader.tsx',
    'apps/frontend/components/player/AdaptiveHlsPlayer.tsx',
  ]) {
    const src = readFileSync(p, 'utf8');
    assert.ok(!src.includes('hls.js'), `${p} must not bundle hls.js in LIFF path`);
    assert.ok(!src.includes("from 'sharp'") && !src.includes('from "sharp"'), `${p} must not import sharp`);
  }
  ok('RAM guard: LIFF viewport path carries zero heavy media deps');
}

async function main(): Promise<void> {
  await sectionService();
  sectionBackendParity();
  sectionFrontendParity();
}

void main();
