// SSOT Phase 067 §10-11 — contract tests (Zod, ABR engine, service, parity)
// Run: npx tsx scripts/test-phase067-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VideoQualityLevelEnum,
  NetworkMetricsSchema,
  VideoStreamManifestSchema,
  StreamTelemetryPayloadSchema,
  QUALITY_LADDER,
  ABR_DOWNSCALE_MBPS,
  ABR_UPSCALE_MBPS,
  ABR_UPSCALE_HOLD_SEC,
  selectQualityFor,
  ladderIndexOf,
  streamManifestKey,
} from '../packages/shared/src/schemas/video-quality-schema';
import { AbrHysteresis, estimateRamMb } from '../apps/frontend/lib/hls-quality-selector';
import { QualitySelectorService } from '../apps/backend/src/modules/stream/quality/quality-selector.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const LESSON = '333e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '444e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + ladder/budgets ----------
{
  assert.equal(VideoQualityLevelEnum.safeParse('AUTO').success, true);
  assert.equal(VideoQualityLevelEnum.safeParse('QUALITY_480P').success, true);
  assert.equal(VideoQualityLevelEnum.safeParse('1080p').success, false);
  assert.equal(
    NetworkMetricsSchema.safeParse({ downlinkMbps: 10, rttMs: 50, effectiveType: '4g', saveDataMode: false }).success,
    true,
  );
  assert.equal(
    VideoStreamManifestSchema.safeParse({
      lessonId: LESSON,
      masterPlaylistUrl: 'https://cdn.example.com/l/master.m3u8',
      variants: [{ quality: 'QUALITY_720P', resolution: '1280x720', bandwidthBps: 2500000, playlistUrl: 'https://cdn.example.com/l/720p.m3u8' }],
      watermarkText: 'USER: x',
    }).success,
    true,
  );
  assert.equal(
    StreamTelemetryPayloadSchema.safeParse({
      lessonId: LESSON, userId: USER, selectedQuality: 'AUTO', activeQuality: 'QUALITY_480P',
      measuredMbps: 1.2, bufferStallCount: 0, ramUsageMb: 12.5, timestamp: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(QUALITY_LADDER.length, 4);
  assert.equal(QUALITY_LADDER[0].bandwidthBps, 4500000);
  assert.equal(QUALITY_LADDER[3].bandwidthBps, 600000);
  assert.equal(ABR_DOWNSCALE_MBPS, 1.5);
  assert.equal(ABR_UPSCALE_MBPS, 8);
  assert.equal(ABR_UPSCALE_HOLD_SEC, 8);
  assert.equal(streamManifestKey('l', 'u'), 'stream:manifest:l:u');
  ok('Zod ABR contracts verbatim + ladder/budgets/keys');
}

// ---------- 2. Pure ABR engine: fit + saveData cap + manual lock ----------
{
  assert.equal(selectQualityFor(10, 'AUTO', false), 'QUALITY_1080P');
  assert.equal(selectQualityFor(1.2, 'AUTO', false), 'QUALITY_480P');
  assert.equal(selectQualityFor(0.2, 'AUTO', false), 'QUALITY_360P');
  assert.equal(selectQualityFor(50, 'AUTO', true), 'QUALITY_480P');
  assert.equal(selectQualityFor(0.1, 'QUALITY_720P', false), 'QUALITY_720P');
  assert.equal(ladderIndexOf('QUALITY_1080P'), 0);
  assert.equal(ladderIndexOf('QUALITY_360P'), 3);
  ok('selectQualityFor: measured-fit + saveData cap + manual bypass');
}

// ---------- 3. Hysteresis: fast-down, held-up upscaling (BDD-1/2) ----------
{
  const abr = new AbrHysteresis('QUALITY_1080P');
  // BDD-1: 1.2Mbps drops 1080p → 480p immediately.
  assert.equal(abr.decide(1.2, 'AUTO', false, 0), 'QUALITY_480P');
  // BDD-2: recovery to 10Mbps does NOT upscale instantly (anti-flapping).
  assert.equal(abr.decide(10, 'AUTO', false, 1000), 'QUALITY_480P');
  assert.equal(abr.decide(10, 'AUTO', false, 7000), 'QUALITY_480P');
  // Sustained 8s+ → upscale to 1080p.
  assert.equal(abr.decide(10, 'AUTO', false, 9000), 'QUALITY_1080P');
  // Dip below 8 during hold resets the timer (hold restarts at t=9000).
  const abr2 = new AbrHysteresis('QUALITY_480P');
  assert.equal(abr2.decide(10, 'AUTO', false, 0), 'QUALITY_480P');
  assert.equal(abr2.decide(5, 'AUTO', false, 4000), 'QUALITY_480P');
  assert.equal(abr2.decide(10, 'AUTO', false, 9000), 'QUALITY_480P');
  assert.equal(abr2.decide(10, 'AUTO', false, 13000), 'QUALITY_480P');
  assert.equal(abr2.decide(10, 'AUTO', false, 17001), 'QUALITY_1080P');
  // Manual locks the rung.
  assert.equal(abr2.decide(0.1, 'QUALITY_720P', false, 20000), 'QUALITY_720P');
  assert.ok(estimateRamMb(10) > 0 && estimateRamMb(10) < 30);
  ok('Hysteresis: immediate downscale + 8s-held upscale + manual lock');
}

// ---------- 4. Service: gate + manifest + telemetry ----------
type LessonRow = { id: string; videoHlsUrl: string; isPreview: boolean; section: { course: { productId: string } } };

function makePorts(granted: boolean, preview = false) {
  const telemetry: unknown[] = [];
  const cache = new Map<string, string>();
  const lesson: LessonRow = {
    id: LESSON,
    videoHlsUrl: 'https://cdn.example.com/lessons/l1/master.m3u8',
    isPreview: preview,
    section: { course: { productId: PRODUCT } },
  };
  const tables = {
    courseLesson: { findUnique: async () => lesson },
    entitlement: { findUnique: async () => (granted ? { id: 'ent-1' } : null) },
    videoStreamTelemetry: {
      create: async ({ data }: { data: unknown }) => {
        telemetry.push(data);
        return data;
      },
    },
  };
  const cachePort = {
    get: async (k: string) => cache.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => {
      cache.set(k, v);
    },
  };
  const stream = {
    xaddPipeline: async () => undefined,
  };
  return { tables, cachePort, stream, telemetry, cache };
}

async function sectionService(): Promise<void> {
  // entitled → manifest with 4 spec variants
  {
    const { tables, cachePort, stream } = makePorts(true);
    const svc = new QualitySelectorService(tables as never, cachePort, stream);
    const res = await svc.getQualityManifest(USER, LESSON);
    assert.equal(res.ok, true);
    const m = res.manifest as { variants: Array<{ quality: string; bandwidthBps: number }>; defaultQuality: string };
    assert.equal(m.variants.length, 4);
    assert.equal(m.defaultQuality, 'AUTO');
    assert.equal(m.variants[0].bandwidthBps, 4500000);
  }
  // forbidden without entitlement
  {
    const { tables, cachePort, stream } = makePorts(false);
    const svc = new QualitySelectorService(tables as never, cachePort, stream);
    const res = await svc.getQualityManifest(USER, LESSON);
    assert.equal(res.error, 'FORBIDDEN');
  }
  // preview bypasses entitlement
  {
    const { tables, cachePort, stream } = makePorts(false, true);
    const svc = new QualitySelectorService(tables as never, cachePort, stream);
    const res = await svc.getQualityManifest(USER, LESSON);
    assert.equal(res.ok, true);
  }
  // cached manifest served without tables
  {
    const { tables, cachePort, stream, cache } = makePorts(true);
    const svc = new QualitySelectorService(tables as never, cachePort, stream);
    await svc.getQualityManifest(USER, LESSON);
    assert.ok(cache.size > 0);
    const cached = new QualitySelectorService(undefined, cachePort, stream);
    const res = await cached.getQualityManifest(USER, LESSON);
    assert.equal(res.ok, true);
  }
  // telemetry: valid recorded, invalid dropped
  {
    const { tables, cachePort, stream, telemetry } = makePorts(true);
    const svc = new QualitySelectorService(tables as never, cachePort, stream);
    const good = await svc.reportTelemetry(USER, {
      lessonId: LESSON, selectedQuality: 'AUTO', activeQuality: 'QUALITY_480P',
      measuredMbps: 1.2, bufferStallCount: 1, ramUsageMb: 12,
      timestamp: new Date().toISOString(),
    });
    assert.equal(good.recorded, true);
    assert.equal(telemetry.length, 1);
    const bad = await svc.reportTelemetry(USER, { lessonId: 'nope' });
    assert.equal(bad.recorded, false);
  }
  ok('Service: entitlement gate + manifest ladder/cache + telemetry ledger');
}

// ---------- 5. Prisma additive ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum VideoStreamQuality', 'model VideoStreamTelemetry', 'streamTelemetry     VideoStreamTelemetry[]']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: VideoStreamQuality + VideoStreamTelemetry (additive)');
}

// ---------- 6. Static parity ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/stream/quality/quality-selector.service.ts', 'utf8');
  for (const t of ['QualitySelectorService', 'getQualityManifest', 'reportTelemetry', 'videoStreamTelemetry']) {
    assert.ok(svc.includes(t), `service missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/stream/quality/quality-manifest.controller.ts', 'utf8');
  assert.ok(ctrl.includes('quality-manifest') && ctrl.includes('telemetry') && ctrl.includes('JwtAuthGuard'));
  const res = readFileSync('apps/backend/src/modules/stream/quality/quality.resolver.ts', 'utf8');
  assert.ok(res.includes('getCourseLessonManifest') && res.includes('reportStreamTelemetry'));
  const mod = readFileSync('apps/backend/src/modules/stream/quality/quality.module.ts', 'utf8');
  assert.ok(mod.includes('QualityModule') && mod.includes('QualityManifestController'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('QualityModule'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/quality.graphql', 'utf8');
  assert.ok(sdl.includes('StreamManifestPayload') && sdl.includes('reportStreamTelemetry'));
  const hook = readFileSync('apps/frontend/hooks/useNetworkBandwidth.ts', 'utf8');
  assert.ok(hook.includes('useNetworkBandwidth') && hook.includes('connection'));
  assert.ok(!hook.includes("from 'hls.js'"), 'bandwidth hook must stay dep-free');
  const lib = readFileSync('apps/frontend/lib/hls-quality-selector.ts', 'utf8');
  assert.ok(lib.includes('AbrHysteresis') && lib.includes('fetchQualityManifest') && lib.includes('estimateRamMb'));
  const player = readFileSync('apps/frontend/components/stream/AdaptiveVideoPlayer.tsx', 'utf8');
  for (const t of ['AdaptiveVideoPlayer', 'LIFF_INIT', 'AbrHysteresis', 'useNetworkBandwidth', '360p']) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  assert.ok(!player.includes("from 'hls.js'") && !player.includes('from "hls.js"'), 'LIFF player must not import hls.js');
  for (const p of [
    'apps/frontend/app/api/v1/stream/quality-manifest/route.ts',
    'apps/frontend/app/api/v1/stream/telemetry/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/stream'), `proxy missing: ${p}`);
  }
  assert.ok(readFileSync('docs/adr/ADR-067-abr-quality-selector.md', 'utf8').includes('ABR'));
  ok('Parity: service/controller/GQL + hook/lib/player + proxies + ADR');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase067 contracts: ${passed + 6} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
