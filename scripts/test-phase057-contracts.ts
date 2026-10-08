// SSOT Phase 057 §10 — contract tests (Zod, use-cases, resolver, wiring, RAM)
// Run: npx tsx scripts/test-phase057-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SyncContentTypeEnum,
  EbookProgressSyncSchema,
  VideoProgressSyncSchema,
  SyncBroadcastPayloadSchema,
  ForceSyncInputSchema,
  SYNC_NAMESPACE,
  SYNC_FANOUT_BUDGET_MS,
  SYNC_CLIENT_THROTTLE_MS,
  SYNC_WRITEBACK_SEC,
  SYNC_WIRE_MAX_BYTES,
  SYNC_TICKET_TTL_SEC,
  syncRoomKey,
  syncRoomChannel,
  ebookProgressCacheKey,
  videoProgressCacheKey,
  syncQueueName,
  isSyncPayloadWithinBudget,
  lastWriteWins,
} from '../packages/shared/src/schemas/progress-sync-contract';
import { syncEbookProgress } from '../apps/backend/src/modules/sync/application/use-cases/sync-ebook-progress.use-case';
import { syncVideoProgress } from '../apps/backend/src/modules/sync/application/use-cases/sync-video-progress.use-case';
import { ConflictResolverService } from '../apps/backend/src/modules/sync/domain/services/conflict-resolver.service';
import { drainProgressQueues } from '../apps/backend/src/modules/sync/application/workers/progress-persistence.worker';
import { RedisPubSubAdapter } from '../apps/backend/src/infra/redis/redis-pubsub.adapter';
// NOTE: Gateway/Controller/Module/Resolver carry Nest (parameter) decorators
// which tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–056 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const TENANT = '111e4567-e89b-12d3-a456-426614174000';
const USER = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';
const EBOOK = '333e4567-e89b-12d3-a456-426614174000';
const LESSON = '444e4567-e89b-12d3-a456-426614174000';

const EBOOK_INPUT = {
  tenantId: TENANT, userId: USER, productId: PRODUCT, ebookId: EBOOK,
  lastPage: 43, totalPages: 300, deviceId: 'web-1', clientTimestamp: 1700000000000,
};
const VIDEO_INPUT = {
  tenantId: TENANT, userId: USER, productId: PRODUCT, lessonId: LESSON,
  watchedSec: 95, durationSec: 600, isCompleted: false, deviceId: 'liff-1', clientTimestamp: 1700000001000,
};

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + policy ----------
{
  assert.equal(SyncContentTypeEnum.safeParse('EBOOK').success, true);
  assert.equal(SyncContentTypeEnum.safeParse('COURSE_LESSON').success, true);
  assert.equal(SyncContentTypeEnum.safeParse('COURSE_VIDEO').success, false);
  assert.equal(EbookProgressSyncSchema.safeParse(EBOOK_INPUT).success, true);
  assert.equal(EbookProgressSyncSchema.safeParse({ ...EBOOK_INPUT, lastPage: 0 }).success, false);
  assert.equal(VideoProgressSyncSchema.safeParse(VIDEO_INPUT).success, true);
  assert.equal(VideoProgressSyncSchema.safeParse({ ...VIDEO_INPUT, watchedSec: -1 }).success, false);
  assert.equal(SyncBroadcastPayloadSchema.safeParse({ contentType: 'EBOOK', ebookData: EBOOK_INPUT, serverTimestamp: 1 }).success, true);
  assert.equal(ForceSyncInputSchema.safeParse({ productId: PRODUCT, contentType: 'EBOOK', lastPage: 5 }).success, true);
  assert.equal(ForceSyncInputSchema.safeParse({ productId: 'bad', contentType: 'EBOOK' }).success, false);

  assert.equal(SYNC_NAMESPACE, '/ws/progress-sync');
  assert.equal(SYNC_FANOUT_BUDGET_MS, 100);
  assert.equal(SYNC_CLIENT_THROTTLE_MS, 3000);
  assert.equal(SYNC_WRITEBACK_SEC, 30);
  assert.equal(SYNC_WIRE_MAX_BYTES, 200);
  assert.equal(SYNC_TICKET_TTL_SEC, 30);
  assert.equal(syncRoomKey(TENANT, USER), `tenant:${TENANT}:user:${USER}`);
  assert.ok(syncRoomChannel(TENANT, USER).startsWith('sync:room:'));
  assert.equal(ebookProgressCacheKey(USER, EBOOK), `progress:ebook:${USER}:${EBOOK}`);
  assert.equal(videoProgressCacheKey(USER, LESSON), `progress:video:${USER}:${LESSON}`);
  assert.equal(syncQueueName('EBOOK'), 'ebook_progress');
  assert.equal(syncQueueName('COURSE_LESSON'), 'video_progress');
  assert.equal(isSyncPayloadWithinBudget({ a: 1 }), true);
  assert.equal(isSyncPayloadWithinBudget({ pad: 'x'.repeat(300) }), false);
  assert.equal(lastWriteWins(100, 200), 'b');
  assert.equal(lastWriteWins(200, 100), 'a');
  ok('Zod sync contracts verbatim + room/cache/queue/budget/LWW policy');
}

// ---------- 2. Use-cases: cache → broadcast → queue (§5.2 BDD) ----------
async function sectionUseCases(): Promise<void> {
  const hsets: Array<{ key: string; fields: Record<string, string> }> = [];
  const broadcasts: Array<{ channel: string; event: string }> = [];
  const queued: Array<{ queue: string }> = [];
  const ports = {
    cache: { hset: async (key: string, fields: Record<string, string>) => { hsets.push({ key, fields }); } },
    bus: {
      broadcast: async (e: { channel: string; event: string }) => {
        broadcasts.push({ channel: e.channel, event: e.event });
      },
    },
    queue: { enqueue: async (queue: string) => { queued.push({ queue }); } },
  };

  const ebookEnv = await syncEbookProgress(ports, EBOOK_INPUT);
  assert.equal(ebookEnv.event, 'ebook_page_synced');
  assert.equal(ebookEnv.channel, syncRoomChannel(TENANT, USER));
  assert.equal(ebookEnv.payload.contentType, 'EBOOK');
  assert.equal(hsets[0].key, ebookProgressCacheKey(USER, EBOOK));
  assert.equal(hsets[0].fields.lastPage, '43');
  assert.equal(queued[0].queue, 'ebook_progress');

  const videoEnv = await syncVideoProgress(ports, VIDEO_INPUT);
  assert.equal(videoEnv.event, 'video_progress_synced');
  assert.equal(hsets[1].key, videoProgressCacheKey(USER, LESSON));
  assert.equal(hsets[1].fields.watchedSec, '95');
  assert.equal(queued[1].queue, 'video_progress');

  await assert.rejects(syncEbookProgress(ports, { ...EBOOK_INPUT, lastPage: -2 }), /lastPage/i);
  await assert.rejects(syncVideoProgress(ports, { ...VIDEO_INPUT, lessonId: 'bad' }), /lessonId|uuid/i);
  ok('Use-cases: edge-cache → room broadcast → write-back queue + Zod gates');
}

// ---------- 3. Conflict resolver: LWW broadcast + max persisted ----------
{
  const svc = new ConflictResolverService();
  const newer = { position: 43, clientTimestamp: 200, deviceId: 'web-1' };
  const older = { position: 42, clientTimestamp: 100, deviceId: 'liff-1' };
  assert.deepEqual(svc.resolveBroadcast(older, newer), newer);
  assert.deepEqual(svc.resolveBroadcast(newer, older), newer);
  assert.equal(svc.resolvePersisted(42, 43), 43);
  assert.equal(svc.resolvePersisted(43, 42), 43);
  assert.deepEqual(
    svc.resolveBroadcast({ position: 1, clientTimestamp: 1, deviceId: 'd' }, { position: 9, clientTimestamp: 2, deviceId: 'd' }).position,
    9,
  );
  ok('Conflict resolver: last-write-wins broadcast + max-progress persist');
}

// ---------- 4. Write-back worker: batched drain, poison-safe ----------
async function sectionWorker(): Promise<void> {
  const stored = new Map<string, { lastPage: number; watchedSec: number }>([
    [`${USER}:${EBOOK}`, { lastPage: 44, watchedSec: 0 }],
  ]);
  const ebookRows: unknown[] = [{ ...EBOOK_INPUT, lastPage: 43 }, { lastPage: 99 }];
  const videoRows: unknown[] = [{ ...VIDEO_INPUT }];
  const out = await drainProgressQueues(
    {
      queue: {
        drainBatch: async (queue: 'ebook_progress' | 'video_progress') =>
          queue === 'ebook_progress' ? ebookRows.splice(0, 10) : videoRows.splice(0, 10),
      },
      db: {
        upsertEbookProgress: async (a: { userId: string; ebookId: string; lastPage: number }) => {
          if (!a.userId) throw new Error('poison: missing identity');
          const key = `${a.userId}:${a.ebookId}`;
          const prev = stored.get(key)?.lastPage ?? 0;
          const lastPage = Math.max(prev, a.lastPage);
          stored.set(key, { lastPage, watchedSec: 0 });
          return { lastPage };
        },
        upsertVideoProgress: async () => ({ watchedSec: 95 }),
      },
      conflicts: new ConflictResolverService(),
    },
    ['ebook_progress', 'video_progress'],
  );
  assert.equal(out.ebook, 1);
  assert.equal(out.video, 1);
  assert.equal(stored.get(`${USER}:${EBOOK}`)?.lastPage, 44);
  ok('Write-back worker: 30s-batch drain + max-progress + poison-safe counts');
}

// ---------- 5. Pub/Sub adapter: serialize once + event filter ----------
async function sectionPubSub(): Promise<void> {
  const published: Array<{ channel: string; message: string }> = [];
  const adapter = new RedisPubSubAdapter({
    publish: async (channel: string, message: string) => {
      published.push({ channel, message });
    },
    subscribe: async (_channel: string, _handler: (m: string) => void) => () => undefined,
  });
  await adapter.publishRoom('sync:room:t', 'ebook_page_synced', { lastPage: 43 });
  assert.equal(published.length, 1);
  assert.equal(JSON.parse(published[0].message).event, 'ebook_page_synced');
  assert.equal(adapter.fanoutBudgetMs(), SYNC_FANOUT_BUDGET_MS);

  const seen: unknown[] = [];
  const adapter2 = new RedisPubSubAdapter({
    publish: async () => undefined,
    subscribe: async (_c: string, handler: (m: string) => void) => {
      handler(JSON.stringify({ event: 'video_progress_synced', data: { watchedSec: 1 }, serverTimestamp: 1 }));
      handler(JSON.stringify({ event: 'other', data: {}, serverTimestamp: 1 }));
      handler('not-json{{{');
      return () => undefined;
    },
  });
  await adapter2.subscribeRoom('c', 'video_progress_synced', (d) => seen.push(d));
  assert.equal(seen.length, 1);
  ok('Pub/Sub adapter: room publish + event filter + malformed-safe');
}

// ---------- 6. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model ActiveDeviceSession',
    'socketId     String   @unique',
    '@@index([userId, tenantId])',
    'deviceId   String?',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: deviceId cursors + ActiveDeviceSession registry (additive)');
}

// ---------- 7. Static parity: gateway + module + GQL/SDL + hook + overlays ----------
function sectionParity(): void {
  const gw = readFileSync('apps/backend/src/modules/sync/infrastructure/gateways/progress-sync.gateway.ts', 'utf8');
  for (const t of ['ProgressSyncGateway', '@Sse(', "'stream'", 'syncRoomChannel', 'syncEbookProgress', 'syncVideoProgress', 'isSyncPayloadWithinBudget', 'forceSync', 'ActiveDeviceSession', 'SYNC_NAMESPACE']) {
    assert.ok(gw.includes(t), `gateway missing: ${t}`);
  }
  assert.ok(!gw.includes("from 'socket.io") && !gw.includes('from "socket.io'), 'gateway must not import socket.io');
  const rio = readFileSync('apps/backend/src/modules/sync/infrastructure/adapters/redis-io.adapter.ts', 'utf8');
  assert.ok(rio.includes('RedisIoAdapter'));
  const mod = readFileSync('apps/backend/src/modules/sync/sync.module.ts', 'utf8');
  for (const t of ['SyncModule', 'ProgressSyncGateway', 'SyncResolver', 'SyncWriteBackQueue', 'drainProgressQueues', 'SYNC_WRITEBACK_SEC']) {
    assert.ok(mod.includes(t), `sync module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('SyncModule'));
  const res = readFileSync('apps/backend/src/modules/sync/sync.resolver.ts', 'utf8');
  assert.ok(res.includes('forceSyncProgress'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/progress-sync.graphql', 'utf8');
  for (const t of ['onProgressSynced', 'forceSyncProgress', 'SyncProgressPayload', 'ForceSyncInput']) {
    assert.ok(sdl.includes(t), `sync SDL missing: ${t}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useProgressSync.ts', 'utf8');
  // Phase 064 consolidation: hook offline fallback rides the single shared
  // IndexedDB queue (saveProgressToIndexedDB → pendingSyncRecords, drained by
  // flushProgressQueue) instead of the Phase 057-local 'zene-sync' store,
  // which was write-only and never flushed (data-loss risk).
  for (const t of ['useProgressSync', 'EventSource', 'SYNC_CLIENT_THROTTLE_MS', 'SYNC_INIT', 'SYNC_CONFLICT', 'SYNC_ERROR', 'saveProgressToIndexedDB', 'dismissConflict', 'emitEbookPageTurn', 'emitVideoTimeUpdate']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  assert.ok(!hook.includes("from 'socket.io-client'") && !hook.includes('from "socket.io-client"'), 'LIFF hook must not import socket.io-client');
  const reader = readFileSync('apps/frontend/components/reader/CanvasReaderSyncOverlay.tsx', 'utf8');
  for (const t of ['CanvasReaderSyncOverlay', 'พบตำแหน่งอ่านล่าสุด', 'ย้ายไปทันที', 'ซิงก์เรียลไทม์']) {
    assert.ok(reader.includes(t), `reader overlay missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/player/HlsPlayerSyncOverlay.tsx', 'utf8');
  for (const t of ['HlsPlayerSyncOverlay', 'พบตำแหน่งดูล่าสุด', 'ดูต่อทันที']) {
    assert.ok(player.includes(t), `player overlay missing: ${t}`);
  }
  for (const p of ['apps/frontend/app/api/v1/sync/ebook/route.ts', 'apps/frontend/app/api/v1/sync/video/route.ts', 'apps/frontend/app/api/v1/sync/stream/route.ts', 'apps/frontend/app/api/v1/sync/force/route.ts']) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.includes('/api/v1/sync'), `${p} missing backend forward`);
  }
  ok('Parity: SSE gateway + module + GQL/SDL + hook + overlays + 4 proxies');
}

async function main(): Promise<void> {
  await sectionUseCases();
  await sectionWorker();
  await sectionPubSub();
  sectionParity();
}

void main();
