// SSOT Phase 052 §10 — contract tests (Zod, stream, drain, heatmap, queue, wiring)
// Run: npx tsx scripts/test-phase052-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AnalyticsEventTypeEnum,
  ReadTimeTrackingPayloadSchema,
  WatchTimeTrackingPayloadSchema,
  AnalyticsBatchIngestSchema,
  ANALYTICS_STREAM_KEY,
  ANALYTICS_HEARTBEAT_SEC,
  ANALYTICS_FLUSH_SEC,
  ANALYTICS_HEATMAP_SEGMENT_SEC,
  ANALYTICS_RING_CAP,
  ANALYTICS_PULSE_PER_MIN,
  ANALYTICS_DRAIN_BATCH_SEC,
  ANALYTICS_NIL_USER,
  analyticsPulseKey,
  heatmapSegmentIndex,
  completionRate,
  dropoffRate,
  averageDwell,
} from '../packages/shared/src/schemas/analytics-contract';
import { AnalyticsStreamService } from '../apps/backend/src/modules/analytics/services/analytics-stream.service';
import { AnalyticsAggregationService } from '../apps/backend/src/modules/analytics/services/analytics-aggregation.service';
import { HeatmapProcessorService } from '../apps/backend/src/modules/analytics/services/heatmap-processor.service';
import { AnalyticsQueueProcessor } from '../apps/backend/src/modules/analytics/processors/analytics-queue.processor';
import {
  isPulseAllowed,
  stampAnalyticsIdentity,
} from '../apps/backend/src/modules/analytics/dto/analytics-payload.dto';
// NOTE: Controller/Module/Resolver carry Nest (parameter) decorators which
// tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–051 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';
const LESSON_ID = '323e4567-e89b-12d3-a456-426614174000';
const TS = new Date().toISOString();

function readEvent(over: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    productId: PRODUCT_ID,
    ebookId: PRODUCT_ID,
    pageNumber: 4,
    dwellTimeSec: 12,
    scrollDepthPercentage: 100,
    timestamp: TS,
    ...over,
  };
}

function watchEvent(over: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    productId: PRODUCT_ID,
    lessonId: LESSON_ID,
    watchedSec: 5,
    currentTimestampSec: 65,
    durationSec: 600,
    playbackRate: 1.0,
    timestamp: TS,
    ...over,
  };
}

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  for (const s of ['EBOOK_PAGE_DWELL', 'VIDEO_WATCH_HEARTBEAT', 'VIDEO_SEEK_EVENT', 'VIDEO_PAUSE_EVENT', 'VIDEO_COMPLETE_EVENT']) {
    assert.equal(AnalyticsEventTypeEnum.safeParse(s).success, true);
  }
  assert.equal(AnalyticsEventTypeEnum.safeParse('CLICK').success, false);

  assert.equal(ReadTimeTrackingPayloadSchema.safeParse(readEvent()).success, true);
  assert.equal(ReadTimeTrackingPayloadSchema.safeParse(readEvent({ pageNumber: 0 })).success, false);
  assert.equal(ReadTimeTrackingPayloadSchema.safeParse(readEvent({ dwellTimeSec: 0 })).success, false);
  assert.equal(ReadTimeTrackingPayloadSchema.safeParse(readEvent({ dwellTimeSec: 3601 })).success, false);
  assert.equal(ReadTimeTrackingPayloadSchema.parse(readEvent({})).scrollDepthPercentage, 100);

  assert.equal(WatchTimeTrackingPayloadSchema.safeParse(watchEvent()).success, true);
  assert.equal(WatchTimeTrackingPayloadSchema.safeParse(watchEvent({ watchedSec: 0 })).success, false);
  assert.equal(WatchTimeTrackingPayloadSchema.safeParse(watchEvent({ watchedSec: 301 })).success, false);
  assert.equal(WatchTimeTrackingPayloadSchema.safeParse(watchEvent({ playbackRate: 4 })).success, false);
  assert.equal(WatchTimeTrackingPayloadSchema.parse(watchEvent({})).playbackRate, 1.0);

  const batch = {
    tenantId: 'default',
    deviceInfo: { userAgent: 'LIFF', isLiff: true },
    readEvents: [readEvent()],
    watchEvents: [watchEvent()],
  };
  assert.equal(AnalyticsBatchIngestSchema.safeParse(batch).success, true);
  const emptyBatch = { deviceInfo: { userAgent: 't', isLiff: false } };
  assert.deepEqual(AnalyticsBatchIngestSchema.parse(emptyBatch).readEvents, []);
  assert.deepEqual(AnalyticsBatchIngestSchema.parse(emptyBatch).watchEvents, []);

  assert.equal(ANALYTICS_STREAM_KEY, 'stream:analytics:events');
  assert.equal(ANALYTICS_HEARTBEAT_SEC, 5);
  assert.equal(ANALYTICS_FLUSH_SEC, 15);
  assert.equal(ANALYTICS_HEATMAP_SEGMENT_SEC, 5);
  assert.equal(ANALYTICS_RING_CAP, 100);
  assert.equal(ANALYTICS_PULSE_PER_MIN, 30);
  assert.equal(ANALYTICS_DRAIN_BATCH_SEC, 10);
  assert.equal(ANALYTICS_NIL_USER, '00000000-0000-0000-0000-000000000000');
  assert.equal(analyticsPulseKey('u', 7), 'analytics:pulse:u:7');
  assert.equal(heatmapSegmentIndex(0), 0);
  assert.equal(heatmapSegmentIndex(119), 23);
  assert.equal(heatmapSegmentIndex(120), 24);
  assert.equal(completionRate(300, 600), 50);
  assert.equal(completionRate(700, 600), 100);
  assert.equal(completionRate(0, 0), 0);
  assert.equal(dropoffRate(25, 100), 0.25);
  assert.equal(dropoffRate(0, 0), 0);
  assert.equal(averageDwell(120, 4), 30);
  assert.equal(averageDwell(0, 0), 0);
  ok('Zod read/watch/batch verbatim + stream/heatmap/rate helpers');
}

// ---------- 2. Stream fan-in (§5.2: one pipeline round-trip, field mapping) ----------
async function sectionStream(): Promise<void> {
  const calls: Array<{ stream: string; batch: Array<Record<string, string | number>> }> = [];
  const svc = new AnalyticsStreamService({
    xaddPipeline: async (stream: string, batch: Array<Record<string, string | number>>) => {
      calls.push({ stream, batch });
    },
  });
  const { queued } = await svc.pushToStream({
    tenantId: 'default',
    deviceInfo: { userAgent: 'LIFF', isLiff: true },
    readEvents: [{ ...readEvent(), userId: USER_ID } as never],
    watchEvents: [{ ...watchEvent(), userId: USER_ID } as never],
  });
  assert.equal(queued, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, 'stream:analytics:events');
  assert.equal(calls[0].batch.length, 2);
  assert.equal(calls[0].batch[0]['type'], 'READ');
  assert.equal(calls[0].batch[0]['pageNumber'], 4);
  assert.equal(calls[0].batch[1]['type'], 'WATCH');
  assert.equal(calls[0].batch[1]['currentTimestampSec'], 65);
  ok('AnalyticsStreamService: READ+WATCH mapped into a single pipeline batch');
}

// ---------- 3. Batch drain writer (§7.1: append/upsert/max/dropoff/product-resolve) ----------
async function sectionDrain(): Promise<void> {
  const created: unknown[] = [];
  const watchRows = new Map<string, { maxWatchedSec: number; watchedSec: number }>();
  const heatCells = new Map<string, { view: number; dwell: number; drop: number }>();
  const db = {
    ebookPageAnalytics: { create: async (a: unknown) => { created.push(a); return {}; } },
    videoWatchAnalytics: {
      findUnique: async (a: { where: { userId_lessonId: { userId: string; lessonId: string } } }) =>
        watchRows.get(`${a.where.userId_lessonId.userId}:${a.where.userId_lessonId.lessonId}`) ?? null,
      upsert: async (a: { where: { userId_lessonId: { userId: string; lessonId: string } }; update: { watchedSec: { increment: number }; maxWatchedSec: number; lastPositionSec: number; completionRate: number }; create: { watchedSec: number; maxWatchedSec: number; lastPositionSec: number; completionRate: number } }) => {
        const k = `${a.where.userId_lessonId.userId}:${a.where.userId_lessonId.lessonId}`;
        const prev = watchRows.get(k) ?? { maxWatchedSec: 0, watchedSec: 0 };
        watchRows.set(k, {
          maxWatchedSec: a.update.maxWatchedSec,
          watchedSec: prev.watchedSec + (a.update.watchedSec?.increment ?? 0),
        });
        return {};
      },
    },
    contentHeatmapAggregate: {
      upsert: async (a: { where: { productId_contentType_segmentIndex: { productId: string; contentType: string; segmentIndex: number } }; update: { viewCount: { increment: number }; totalDwellTimeSec: { increment: number }; dropoffCount: { increment: number } }; create: { productId: string; contentType: string; segmentIndex: number } }) => {
        const w = a.where.productId_contentType_segmentIndex;
        const k = `${w.productId}:${w.contentType}:${w.segmentIndex}`;
        const prev = heatCells.get(k) ?? { view: 0, dwell: 0, drop: 0 };
        heatCells.set(k, {
          view: prev.view + (a.update.viewCount?.increment ?? 0),
          dwell: prev.dwell + (a.update.totalDwellTimeSec?.increment ?? 0),
          drop: prev.drop + (a.update.dropoffCount?.increment ?? 0),
        });
        return {};
      },
    },
    courseLesson: {
      findUnique: async () => ({ section: { course: { productId: PRODUCT_ID } } }),
    },
  };
  const svc = new AnalyticsAggregationService(db);

  // READ: append-only row + page-indexed heat cell.
  const r = await svc.drainBatch([{
    type: 'READ', userId: USER_ID, ebookId: PRODUCT_ID, productId: PRODUCT_ID,
    pageNumber: 4, dwellTimeSec: 12, scrollDepth: 80,
  }]);
  assert.equal(r.written, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(heatCells.get(`${PRODUCT_ID}:EBOOK:4`), { view: 1, dwell: 12, drop: 0 });

  // WATCH forward: max advances, no drop-off, 5s-bucketed segment 13 (65s).
  await svc.drainBatch([{
    type: 'WATCH', userId: USER_ID, lessonId: LESSON_ID, productId: 'stale-id',
    watchedSec: 5, currentTimestampSec: 65, durationSec: 600,
  }]);
  const row = watchRows.get(`${USER_ID}:${LESSON_ID}`);
  assert.equal(row?.maxWatchedSec, 65);
  assert.equal(row?.watchedSec, 5);
  assert.deepEqual(heatCells.get(`${PRODUCT_ID}:ELEARNING_COURSE:13`), { view: 1, dwell: 5, drop: 0 });

  // WATCH seek-back (65 → 20): max monotonic, drop-off charged to segment 4.
  await svc.drainBatch([{
    type: 'WATCH', userId: USER_ID, lessonId: LESSON_ID, productId: 'stale-id',
    watchedSec: 5, currentTimestampSec: 20, durationSec: 600,
  }]);
  const row2 = watchRows.get(`${USER_ID}:${LESSON_ID}`);
  assert.equal(row2?.maxWatchedSec, 65);
  assert.equal(row2?.watchedSec, 10);
  assert.deepEqual(heatCells.get(`${PRODUCT_ID}:ELEARNING_COURSE:4`), { view: 1, dwell: 5, drop: 1 });

  // Malformed entries are skipped, never crash the batch.
  const skip = await svc.drainBatch([{ type: 'READ', userId: USER_ID } as never]);
  assert.equal(skip.written, 0);
  ok('Aggregation: append/upsert/max-monotonic/seek-drop/product-resolve/skip-bad');
}

// ---------- 4. Heatmap read model (§7.2 dashboard payloads) ----------
async function sectionHeatmap(): Promise<void> {
  const svc = new HeatmapProcessorService({
    contentHeatmapAggregate: {
      findMany: async () => [
        { segmentIndex: 13, viewCount: 100, totalDwellTimeSec: 480, dropoffCount: 25 },
        { segmentIndex: 14, viewCount: 70, totalDwellTimeSec: 300, dropoffCount: 40 },
      ],
    },
    videoWatchAnalytics: {
      aggregate: async () => ({ _avg: { completionRate: 42.5 }, _count: 8 }),
    },
    ebookPageAnalytics: {
      groupBy: async () => [
        { pageNumber: 1, _avg: { dwellTimeSec: 30 }, _count: 4 },
        { pageNumber: 2, _avg: { dwellTimeSec: null }, _count: 0 },
      ],
    },
  });
  const lesson = await svc.getLessonWatchHeatmap(LESSON_ID, PRODUCT_ID);
  assert.equal(lesson.totalViews, 8);
  assert.equal(lesson.averageCompletionRate, 42.5);
  assert.equal(lesson.heatmapSegments.length, 2);
  assert.deepEqual(lesson.heatmapSegments[0], { secondOffset: 65, viewerCount: 100, dropoffRate: 0.25 });
  const book = await svc.getEbookPageDwellAnalytics(PRODUCT_ID);
  assert.equal(book.totalPages, 2);
  assert.deepEqual(book.averageReadTimePerPages[1], { pageNumber: 2, averageDwellSec: 0, totalReads: 0 });
  ok('HeatmapProcessor: lesson segments (offset/dropoff) + ebook dwell metrics');
}

// ---------- 5. Queue processor (FIFO + drain + fail-open) ----------
async function sectionQueue(): Promise<void> {
  let fail = false;
  const writer = {
    drainBatch: async (entries: Array<{ type: string }>) => {
      if (fail) throw new Error('db down');
      return { written: entries.length };
    },
  };
  const q = new AnalyticsQueueProcessor(writer as never);
  assert.equal(q.pending(), 0);
  q.enqueue({
    tenantId: 'default',
    deviceInfo: { userAgent: 't', isLiff: true },
    readEvents: [{ ...readEvent(), userId: USER_ID } as never],
    watchEvents: [{ ...watchEvent(), userId: USER_ID } as never],
  });
  assert.equal(q.pending(), 2);
  const s = await q.drain();
  assert.deepEqual(s, { drained: 2, written: 2, pending: 0 });
  const empty = await q.drain();
  assert.deepEqual(empty, { drained: 0, written: 0, pending: 0 });
  q.enqueue({
    tenantId: 'default',
    deviceInfo: { userAgent: 't', isLiff: true },
    readEvents: [{ ...readEvent(), userId: USER_ID } as never],
    watchEvents: [],
  });
  fail = true;
  const bad = await q.drain();
  assert.equal(bad.written, 0); // dropped, never wedged
  ok('QueueProcessor: FIFO enqueue/drain/empty/fail-open');
}

// ---------- 6. DTO pure helpers (stamp + shield verdict) ----------
{
  const stamped = stampAnalyticsIdentity(
    {
      tenantId: 'x',
      deviceInfo: { userAgent: 'u', isLiff: true },
      readEvents: [{ ...readEvent(), userId: 'spoofed' } as never],
      watchEvents: [{ ...watchEvent(), userId: 'spoofed' } as never],
    },
    USER_ID,
  );
  assert.equal(stamped.readEvents[0].userId, USER_ID);
  assert.equal(stamped.watchEvents[0].userId, USER_ID);
  assert.equal(isPulseAllowed(1), true);
  assert.equal(isPulseAllowed(30), true);
  assert.equal(isPulseAllowed(31), false);
  ok('DTO: server identity stamp overwrites spoofed ids; 30/min shield verdict');
}

// ---------- 7. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model EbookPageAnalytics',
    'model VideoWatchAnalytics',
    'model ContentHeatmapAggregate',
    'ebookPageAnalytics  EbookPageAnalytics[]',
    'videoWatchAnalytics VideoWatchAnalytics[]',
    'maxWatchedSec   Int      @default(0)',
    'completionRate  Float    @default(0.0)',
    'totalDwellTimeSec BigInt      @default(0)',
    '@@unique([userId, lessonId])',
    '@@unique([productId, contentType, segmentIndex])',
    '@@index([ebookId, pageNumber])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: page/watch/heatmap models + User relations + uniques');
}

// ---------- 8. Static parity (gateway + module + aliases + GQL/SDL + hook + UI) ----------
function sectionStaticParity(): void {
  const controller = readFileSync('apps/backend/src/modules/analytics/controllers/analytics-ingestion.controller.ts', 'utf8');
  for (const t of ["Controller('api/v1/analytics')", "'pulse'", '202', 'JwtAuthGuard', 'stampAnalyticsIdentity', 'isPulseAllowed', 'TOO_MANY_REQUESTS']) {
    assert.ok(controller.includes(t), `controller missing: ${t}`);
  }
  const module = readFileSync('apps/backend/src/modules/analytics/analytics.module.ts', 'utf8');
  for (const t of ['AnalyticsStreamService', 'AnalyticsAggregationService', 'HeatmapProcessorService', 'AnalyticsQueueProcessor', 'AnalyticsResolver', 'useFactory', 'startDrainLoop']) {
    assert.ok(module.includes(t), `module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('AnalyticsModule'));
  const redis = readFileSync('apps/backend/src/infra/redis/redis-cluster.service.ts', 'utf8');
  assert.ok(redis.includes('xaddPipeline'));
  const alias1 = readFileSync('apps/backend/src/api/graphql/analytics.resolver.ts', 'utf8');
  assert.ok(alias1.includes('AnalyticsResolver'));
  const alias2 = readFileSync('apps/backend/src/api/webhooks/analytics.controller.ts', 'utf8');
  assert.ok(alias2.includes('AnalyticsIngestionController'));

  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/analytics.graphql/schema.graphql', 'utf8');
  for (const t of ['recordReadTimePulse', 'recordWatchTimePulse', 'getLessonWatchHeatmap', 'getEbookPageDwellAnalytics', 'HeatmapSegment', 'PageDwellMetric']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }

  const proxy = readFileSync('apps/frontend/app/api/v1/analytics/pulse/route.ts', 'utf8');
  for (const t of ['/api/v1/analytics/pulse', 'cookie', '503']) {
    assert.ok(proxy.includes(t), `proxy missing: ${t}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useReadWatchTracker.ts', 'utf8');
  for (const t of ['trackPageDwell', 'trackVideoPulse', 'flushMetrics', 'sendBeacon', 'visibilitychange', 'beforeunload', 'ANALYTICS_RING_CAP', 'retry-queue']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const viewer = readFileSync('apps/frontend/components/analytics/HeatmapViewer.tsx', 'utf8');
  for (const t of ['HeatmapViewer', 'dropoffRate', 'secondOffset', 'viewerCount']) {
    assert.ok(viewer.includes(t), `viewer missing: ${t}`);
  }
  const reader = readFileSync('apps/frontend/app/(liff)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(reader.includes('useReadWatchTracker'));
  const lesson = readFileSync('apps/frontend/app/(liff)/course/[courseId]/lesson/[lessonId]/page.tsx', 'utf8');
  assert.ok(lesson.includes('trackVideoPulse'));
  ok('Static parity: gateway + module + aliases + GQL/SDL + proxy + hook + viewer + page wiring');
}

async function main(): Promise<void> {
  await sectionStream();
  await sectionDrain();
  await sectionHeatmap();
  await sectionQueue();
  sectionStaticParity();
}

void main();
