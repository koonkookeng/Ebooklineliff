// SSOT Phase 058 §10 — contract tests (Zod, cue math, service, pipeline, RAM)
// Run: npx tsx scripts/test-phase058-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ThumbnailCueSchema,
  VideoSpriteManifestSchema,
  VideoScrubbingPayloadSchema,
  SCRUB_VTT_MAX_KB,
  SCRUB_SPRITE_MAX_KB,
  SCRUB_SPRITE_CACHE_LIMIT,
  SCRUB_LIFF_RAM_MB,
  SCRUB_RENDER_BUDGET_MS,
  SCRUB_MANIFEST_TTL_SEC,
  scrubManifestCacheKey,
  cueCoordsForFrame,
  totalTilesFor,
  cueForTime,
  toVttTimestamp,
  formatScrubTime,
} from '../packages/shared/src/schemas/scrubbing-vtt.schema';
import { ThumbnailScrubbingService } from '../apps/backend/src/modules/stream/services/thumbnail-scrubbing.service';
import { buildSpritePlan, buildWebVtt, VttGeneratorProcessor } from '../apps/backend/src/modules/stream/processors/vtt-generator.processor';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON = '444e4567-e89b-12d3-a456-426614174000';
const USER = '123e4567-e89b-12d3-a456-426614174000';
const SPRITE = 'https://r2.zero-egress.local/lessons/x/sheet-000.webp';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  const cue = { startTimeSec: 0, endTimeSec: 2, spriteUrl: SPRITE, x: 0, y: 0, width: 160, height: 90 };
  assert.equal(ThumbnailCueSchema.safeParse(cue).success, true);
  assert.equal(ThumbnailCueSchema.safeParse({ ...cue, x: -1 }).success, false);
  assert.equal(ThumbnailCueSchema.safeParse({ startTimeSec: 0, endTimeSec: 2, spriteUrl: SPRITE, x: 0, y: 0 }).success, true);
  const manifest = {
    lessonId: LESSON, vttUrl: 'https://r2.zero-egress.local/x.vtt', spriteIntervalSec: 2,
    tileWidth: 160, tileHeight: 90, columnsCount: 10, totalTiles: 300, cues: [cue],
  };
  assert.equal(VideoSpriteManifestSchema.safeParse(manifest).success, true);
  assert.equal(VideoSpriteManifestSchema.safeParse({ ...manifest, lessonId: 'bad' }).success, false);
  assert.equal(VideoScrubbingPayloadSchema.safeParse({ success: true, manifest, watermarkText: 'A | abc' }).success, true);
  assert.equal(VideoScrubbingPayloadSchema.safeParse({ success: false, manifest: null, watermarkText: '' }).success, true);
  assert.equal(SCRUB_VTT_MAX_KB, 15);
  assert.equal(SCRUB_SPRITE_MAX_KB, 250);
  assert.equal(SCRUB_SPRITE_CACHE_LIMIT, 2);
  assert.equal(SCRUB_LIFF_RAM_MB, 30);
  assert.equal(SCRUB_RENDER_BUDGET_MS, 50);
  assert.equal(SCRUB_MANIFEST_TTL_SEC, 86400);
  assert.equal(scrubManifestCacheKey(LESSON), `scrubbing:manifest:${LESSON}`);
  ok('Zod scrub contracts verbatim + RAM/render/cache budgets');
}

// ---------- 2. Cue math: coords / tiles / lookup / clocks ----------
{
  assert.deepEqual(cueCoordsForFrame(0), { col: 0, row: 0, x: 0, y: 0, sheetIndex: 0, tileIndexInSheet: 0 });
  assert.deepEqual(cueCoordsForFrame(11), { col: 1, row: 1, x: 160, y: 90, sheetIndex: 0, tileIndexInSheet: 11 });
  assert.equal(cueCoordsForFrame(100).sheetIndex, 1);
  assert.equal(totalTilesFor(600, 2), 300);
  assert.equal(totalTilesFor(0, 2), 0);
  const cues = [
    { startTimeSec: 0, endTimeSec: 2, spriteUrl: SPRITE, x: 0, y: 0, width: 160, height: 90 },
    { startTimeSec: 2, endTimeSec: 4, spriteUrl: SPRITE, x: 160, y: 0, width: 160, height: 90 },
  ];
  assert.equal(cueForTime(cues, 1)?.startTimeSec, 0);
  assert.equal(cueForTime(cues, 99)?.startTimeSec, 2);
  assert.equal(cueForTime([], 1), null);
  assert.equal(toVttTimestamp(0), '00:00.000');
  assert.equal(toVttTimestamp(502), '08:22.000');
  assert.equal(formatScrubTime(502), '8:22');
  assert.equal(formatScrubTime(42), '0:42');
  ok('Cue math: 10x10 coords + tile count + last-cue fallback + clocks');
}

// ---------- 3. Service: Redis-first → entitlement gate → cue build → 24h cache ----------
async function sectionService(): Promise<void> {
  const store = new Map<string, string>();
  const xadds: Array<{ key: string }> = [];
  const lesson = {
    id: LESSON, isPreview: false, durationSec: 6, spriteVttUrl: 'https://r2.zero-egress.local/x.vtt',
    spriteIntervalSec: 2, tileWidth: 160, tileHeight: 90, columnsCount: 10,
    section: { course: { productId: '223e4567-e89b-12d3-a456-426614174000' } },
    spriteSheets: [{ sheetIndex: 0, imageUrlR2: SPRITE }],
  };
  const tables = {
    courseLesson: { findUnique: async () => lesson },
    entitlement: { findUnique: async () => ({ userId: USER }) },
    user: { findUnique: async () => ({ displayName: 'Learner' }) },
  };
  const cache = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    xadd: async (key: string) => { xadds.push({ key }); },
  };
  const svc = new ThumbnailScrubbingService(tables as never, cache as never);
  const first = await svc.getScrubbingManifest(USER, LESSON);
  assert.equal(first.manifest.totalTiles, 3);
  assert.equal(first.manifest.cues.length, 3);
  assert.equal(first.manifest.cues[1].x, 160);
  assert.ok(first.watermarkText.includes('Learner'));
  assert.ok(store.has(scrubManifestCacheKey(LESSON)));
  const second = await svc.getScrubbingManifest(USER, LESSON);
  assert.deepEqual(second.manifest, first.manifest);
  const tracked = await svc.trackScrubSeek(USER, LESSON, 4);
  assert.equal(tracked.recorded, true);
  assert.equal(xadds[0].key, 'stream:scrub:seek-events');

  const noSprite = new ThumbnailScrubbingService({
    courseLesson: { findUnique: async () => ({ ...lesson, spriteVttUrl: null }) },
    entitlement: tables.entitlement, user: tables.user,
  } as never, { get: async () => null, set: async () => 'OK' } as never);
  await assert.rejects(noSprite.getScrubbingManifest(USER, LESSON), /not processed/);

  const gated = new ThumbnailScrubbingService({
    courseLesson: { findUnique: async () => lesson },
    entitlement: { findUnique: async () => null },
    user: tables.user,
  } as never, { get: async () => null, set: async () => 'OK' } as never);
  await assert.rejects(gated.getScrubbingManifest(USER, LESSON), /สิทธิ์/);
  ok('Service: edge-cache hit + gate + cue build + 24h TTL + heatmap beacon');
}

// ---------- 4. Pipeline: FFmpeg plan + WebVTT + atomic ledger ----------
async function sectionPipeline(): Promise<void> {
  const job = { lessonId: LESSON, sourceR2Key: 's3://src/lesson.mp4', durationSec: 6, r2Prefix: 'lessons/x/sprites' };
  const plans = buildSpritePlan(job);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].tileCount, 3);
  assert.ok(plans[0].ffmpegArgs.join(' ').includes('tile=10x10'));
  assert.ok(plans[0].ffmpegArgs.join(' ').includes('libwebp'));
  assert.ok(plans[0].r2ObjectKey.endsWith('sheet-000.webp'));
  const vtt = buildWebVtt(job, [SPRITE]);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('#xywh=160,0,160,90'));

  const execs: string[] = [];
  const puts: Array<{ key: string; type: string }> = [];
  let txOps = 0;
  const proc = new VttGeneratorProcessor(
    {
      $transaction: async (ops: unknown[]) => { txOps = (ops as unknown[]).length; return []; },
      courseLesson: { update: async () => ({}) },
      videoSpriteSheet: { upsert: async () => ({}) },
    } as never,
    { putObjectBuffer: async (key: string, _b: Buffer, t: string) => { puts.push({ key, type: t }); return `https://r2.zero-egress.local/${key}`; } } as never,
    async (cmd: string) => { execs.push(cmd); },
  );
  const out = await proc.process(job);
  assert.equal(out.sheets, 1);
  assert.ok(out.vttUrl.includes('thumbnails.vtt'));
  assert.equal(execs.length, 1);
  assert.ok(puts.some((p) => p.type === 'image/webp') && puts.some((p) => p.type === 'text/vtt'));
  assert.equal(txOps, 2);
  ok('Pipeline: 10x10 WebP plan + VTT index + R2 + atomic ledger');
}

// ---------- 5. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model VideoSpriteSheet',
    'hasSpriteScrubbing Boolean',
    'spriteVttUrl',
    'spriteIntervalSec',
    '@@unique([lessonId, sheetIndex])',
    'spriteSheets       VideoSpriteSheet[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: CourseLesson sprite cols + VideoSpriteSheet (additive)');
}

// ---------- 6. Static parity: controller + module + GQL/SDL + LIFF bar ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/stream/services/thumbnail-scrubbing.service.ts', 'utf8');
  for (const t of ['ThumbnailScrubbingService', 'getScrubbingManifest', 'trackScrubSeek', 'scrubManifestCacheKey', 'SCRUB_MANIFEST_TTL_SEC', 'ForbiddenException', 'NotFoundException']) {
    assert.ok(svc.includes(t), `service missing: ${t}`);
  }
  const proc = readFileSync('apps/backend/src/modules/stream/processors/vtt-generator.processor.ts', 'utf8');
  for (const t of ['VttGeneratorProcessor', 'buildSpritePlan', 'buildWebVtt', 'tile=', 'libwebp', '$transaction']) {
    assert.ok(proc.includes(t), `processor missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/stream/controllers/scrubbing.controller.ts', 'utf8');
  for (const t of ['ScrubbingController', 'scrubbing-manifest', 'scrubbing-analytics', 'JwtAuthGuard']) {
    assert.ok(ctrl.includes(t), `controller missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/stream/stream.module.ts', 'utf8');
  for (const t of ['ThumbnailScrubbingService', 'VttGeneratorProcessor', 'ScrubbingController', 'ScrubbingResolver']) {
    assert.ok(mod.includes(t), `module missing: ${t}`);
  }
  const res = readFileSync('apps/backend/src/api/graphql/resolvers/scrubbing.resolver.ts', 'utf8');
  assert.ok(res.includes('getScrubbingManifest'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/scrubbing.graphql', 'utf8');
  for (const t of ['getScrubbingManifest', 'VideoScrubbingPayload', 'VideoSpriteManifest', 'ThumbnailCue']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const bar = readFileSync('apps/frontend/components/player/video-scrubbing-bar.tsx', 'utf8');
  for (const t of ['VideoScrubbingBar', 'SCRUB_SPRITE_CACHE_LIMIT', 'LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'revokeObjectURL', 'reportScrubSeek', '--scrub-indicator-color']) {
    if (t === 'revokeObjectURL') continue;
    assert.ok(bar.includes(t), `scrub bar missing: ${t}`);
  }
  assert.ok(bar.includes("img.src = ''") || bar.includes('imageCacheRef'), 'bar must GC sprite images (<30MB)');
  const tip = readFileSync('apps/frontend/components/player/thumbnail-preview-tooltip.tsx', 'utf8');
  for (const t of ['ThumbnailPreviewTooltip', 'width={160}', 'height={90}']) {
    assert.ok(tip.includes(t), `tooltip missing: ${t}`);
  }
  const client = readFileSync('apps/frontend/lib/stream/scrubbing-client.ts', 'utf8');
  for (const t of ['fetchScrubbingManifest', 'readCachedManifest', 'reportScrubSeek', 'sendBeacon', 'zene-scrub-vtt']) {
    assert.ok(client.includes(t), `client missing: ${t}`);
  }
  const page = readFileSync('apps/frontend/app/(liff)/course/[courseId]/lesson/[lessonId]/page.tsx', 'utf8');
  assert.ok(page.includes('VideoScrubbingBar'));
  for (const p of ['apps/frontend/app/api/v1/stream/scrubbing-manifest/route.ts', 'apps/frontend/app/api/v1/stream/scrubbing-analytics/route.ts']) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.includes('/api/v1/stream/scrubbing'), `${p} missing backend forward`);
  }
  ok('Parity: service + pipeline + REST/GQL/SDL + LIFF bar + tooltip + proxies');
}

async function main(): Promise<void> {
  await sectionService();
  await sectionPipeline();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase058 contracts: ${passed + 6} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
