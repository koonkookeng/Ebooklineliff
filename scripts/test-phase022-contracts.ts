// SSOT Phase 022 §10 — contract tests (environment detection, safe-area, metrics pipeline)
// Run: npx tsx scripts/test-phase022-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EnvironmentTypeEnum,
  SafeAreaInsetsSchema,
  ViewportMetricsSchema,
  SyncEnvironmentPayloadSchema,
  LayoutModeEnum,
} from '../packages/shared/src/schemas/environment-contract';
import { EnvironmentAnalyticsService } from '../apps/backend/src/modules/analytics/events/environment-metrics.event';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';

const UID = '123e4567-e89b-12d3-a456-426614174001';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const baseMetrics = {
  windowWidth: 390,
  windowHeight: 844,
  devicePixelRatio: 3,
  isTouchDevice: true,
  safeArea: { top: 59, bottom: 34, left: 0, right: 0 },
  environment: 'LINE_LIFF_IOS',
} as const;

// ---------- 1. Environment enum (7 values, §3.1) ----------
{
  const envs = [
    'LINE_LIFF_IOS', 'LINE_LIFF_ANDROID', 'STANDALONE_PWA', 'MOBILE_SAFARI',
    'MOBILE_CHROME', 'IN_APP_WEBVIEW', 'DESKTOP_BROWSER',
  ];
  for (const env of envs) assert.equal(EnvironmentTypeEnum.safeParse(env).success, true);
  assert.equal(EnvironmentTypeEnum.safeParse('LINE_MINI_APP').success, false);
  assert.equal(EnvironmentTypeEnum.options.length, 7);
  ok('EnvironmentTypeEnum accepts 7 envs, rejects unknown');
}

// ---------- 2. Safe-area insets (non-negative, §3.1) ----------
{
  assert.equal(SafeAreaInsetsSchema.safeParse({ top: 59, bottom: 34, left: 0, right: 0 }).success, true);
  assert.equal(SafeAreaInsetsSchema.safeParse({ top: -1, bottom: 0, left: 0, right: 0 }).success, false);
  assert.equal(SafeAreaInsetsSchema.safeParse({ top: 0, bottom: 0, left: 0 }).success, false);
  ok('SafeAreaInsets requires all 4 non-negative insets');
}

// ---------- 3. Viewport metrics (positive dims, §3.1) ----------
{
  assert.equal(ViewportMetricsSchema.safeParse(baseMetrics).success, true);
  assert.equal(ViewportMetricsSchema.safeParse({ ...baseMetrics, windowWidth: 0 }).success, false);
  assert.equal(ViewportMetricsSchema.safeParse({ ...baseMetrics, devicePixelRatio: -1 }).success, false);
  ok('ViewportMetrics enforces positive dimensions');
}

// ---------- 4. Sync payload (optional uuid userId, datetime, §3.1) ----------
{
  const good = {
    tenantId: 'default', metrics: baseMetrics,
    userAgent: 'Line/14.0.0', timestamp: new Date().toISOString(),
  };
  assert.equal(SyncEnvironmentPayloadSchema.safeParse(good).success, true);
  assert.equal(SyncEnvironmentPayloadSchema.safeParse({ ...good, userId: UID }).success, true);
  assert.equal(SyncEnvironmentPayloadSchema.safeParse({ ...good, userId: 'not-uuid' }).success, false);
  assert.equal(SyncEnvironmentPayloadSchema.safeParse({ ...good, timestamp: 'yesterday' }).success, false);
  assert.equal(SyncEnvironmentPayloadSchema.safeParse({ ...good, userAgent: 123 }).success, false);
  ok('SyncEnvironmentPayload validates uuid/datetime boundaries');
}

// ---------- 5-7 use async service: run inside main (tsx CJS has no top-level await) ----------
async function main(): Promise<void> {
{
  const created: unknown[] = [];
  const stub = {
    userDeviceMetric: { create: async (args: unknown) => { created.push(args); return {}; } },
  } as unknown as PrismaService;
  const svc = new EnvironmentAnalyticsService(stub);
  const mk = (environment: typeof baseMetrics.environment, extra: Record<string, unknown> = {}) => ({
    tenantId: 'default', metrics: { ...baseMetrics, environment, ...extra },
    userAgent: 'Line/14.0.0', timestamp: new Date().toISOString(),
  });

  const liff = await svc.processAndRecordMetrics(mk('LINE_LIFF_ANDROID'));
  assert.equal(liff.success, true);
  assert.equal(liff.recommendedLayoutMode, 'LIFF_EMBEDDED_COMPACT');
  const webview = await svc.processAndRecordMetrics(mk('IN_APP_WEBVIEW'));
  assert.equal(webview.recommendedLayoutMode, 'WEBVIEW_FULLSCREEN_SAFE');
  const desktop = await svc.processAndRecordMetrics(
    mk('DESKTOP_BROWSER', { windowWidth: 1440, isTouchDevice: false, safeArea: { top: 0, bottom: 0, left: 0, right: 0 } }),
  );
  assert.equal(desktop.recommendedLayoutMode, 'STANDARD_WEB');
  // Invalid payload → fail-closed default, no write queued
  const bad = await svc.processAndRecordMetrics({ tenantId: '', metrics: {}, userAgent: '' } as never);
  assert.equal(bad.success, false);
  assert.equal(LayoutModeEnum.safeParse(liff.recommendedLayoutMode).success, true);
  await new Promise((r) => setTimeout(r, 10)); // let fire-and-forget writes land
  assert.equal(created.length, 3);
  ok('Service maps 3 layout modes + fire-and-forget persist (Gate 7)');
}

// ---------- 6. GraphQL SDL parity (§3.2) ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/environment.graphql/schema.graphql', 'utf8');
  for (const env of EnvironmentTypeEnum.options) assert.ok(sdl.includes(env), `SDL missing ${env}`);
  assert.ok(sdl.includes('syncEnvironmentMetrics(input: SyncEnvironmentInput!)'));
  assert.ok(sdl.includes('recommendedLayoutMode'));
  ok('GraphQL SDL mirrors Zod enum + mutation');
}

// ---------- 7. CSS tokens (§2.1) ----------
{
  const css = readFileSync('apps/frontend/styles/safe-area.css', 'utf8');
  for (const token of ['--sat', '--sab', '--sal', '--sar', '--real-vh', '.pt-safe', '.pb-safe', '.h-dvh-custom', '.safe-bottom-bar']) {
    assert.ok(css.includes(token), `CSS missing ${token}`);
  }
  assert.ok(css.includes('calc(var(--sab) + 12px)'));
  ok('CSS exposes safe-area vars + bottom-bar rhythm');
}

console.log(`\nPhase 022 contracts: ${passed}/7 groups passed`);
}

void main();
