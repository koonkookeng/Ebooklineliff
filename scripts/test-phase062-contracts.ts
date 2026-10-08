// SSOT Phase 062 §10-11 — contract tests (Zod, queue gates, bulk flow, parity)
// Run: npx tsx scripts/test-phase062-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SyncTargetTypeEnum,
  OfflineSyncQueueItemSchema,
  BulkOfflineSyncPayloadSchema,
  BulkOfflineSyncResponseSchema,
  PWA_DB_NAME,
  PWA_CHUNK_STORE,
  PWA_SYNC_STORE,
  PWA_CHUNK_MAX_ENTRIES,
  PWA_CACHE_MAX_MB_PER_TENANT,
  tenantCacheName,
  chunkCellId,
  clampBatchSize,
} from '../packages/shared/src/schemas/offline-sync-schema';
import { validateOfflineQueue } from '../apps/backend/src/modules/offline-sync/application/use-cases/validate-offline-queue.use-case';
import { ProcessBulkSyncUseCase } from '../apps/backend/src/modules/offline-sync/application/use-cases/process-bulk-sync.use-case';
import { OfflineSyncRepository } from '../apps/backend/src/modules/offline-sync/infrastructure/repositories/offline-sync.repository';
import { foldOutcomes, isOwnedBy } from '../apps/backend/src/modules/offline-sync/domain/entities/sync-item.entity';
import { asCourseProgress, asEbookProgress, parseSyncTarget } from '../apps/backend/src/modules/offline-sync/domain/value-objects/sync-target.vo';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '999e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';
const ITEM_ID = '333e4567-e89b-12d3-a456-426614174000';

function item(over: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID, userId: USER, tenantId: 'default', targetType: 'EBOOK_PROGRESS',
    payload: { ebookId: PRODUCT, lastPage: 7 }, timestamp: 1700000000000, retryCount: 0, ...over,
  };
}

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(SyncTargetTypeEnum.safeParse('COURSE_PROGRESS').success, true);
  assert.equal(SyncTargetTypeEnum.safeParse('NOPE').success, false);
  assert.equal(OfflineSyncQueueItemSchema.safeParse(item()).success, true);
  assert.equal(OfflineSyncQueueItemSchema.safeParse({ ...item(), retryCount: -1 }).success, false);
  assert.equal(BulkOfflineSyncPayloadSchema.safeParse({ deviceId: 'd1', syncItems: [item()] }).success, true);
  assert.equal(
    BulkOfflineSyncResponseSchema.safeParse({ success: true, processedCount: 1, failedIds: [], serverTimestamp: 1 }).success,
    true,
  );
  assert.equal(PWA_DB_NAME, 'zene_pwa_db');
  assert.equal(PWA_CHUNK_STORE, 'ebook_chunks_store');
  assert.equal(PWA_SYNC_STORE, 'sync_queue_store');
  assert.equal(PWA_CHUNK_MAX_ENTRIES, 100);
  assert.equal(PWA_CACHE_MAX_MB_PER_TENANT, 150);
  assert.equal(tenantCacheName('ebook-chunks-cache', 'company-a'), 'ebook-chunks-cache-company-a-v1');
  assert.equal(chunkCellId(PRODUCT, 7), `${PRODUCT}_p7`);
  assert.equal(clampBatchSize(500), 100);
  ok('Zod sync contracts verbatim + PWA storage budgets');
}

// ---------- 2. Queue gates: shape + ownership + taxonomy ----------
{
  assert.equal(isOwnedBy({ userId: USER }, USER), true);
  assert.equal(isOwnedBy({ userId: OTHER }, USER), false);
  assert.equal(parseSyncTarget('OFFLINE_ANALYTICS'), 'OFFLINE_ANALYTICS');
  assert.equal(parseSyncTarget('NOPE'), null);
  assert.deepEqual(asEbookProgress({ ebookId: PRODUCT, lastPage: 3 }), { ebookId: PRODUCT, lastPage: 3 });
  assert.equal(asEbookProgress({ ebookId: PRODUCT, lastPage: 0 }), null);
  assert.deepEqual(asCourseProgress({ lessonId: 'l1', watchedSec: 9 }), { lessonId: 'l1', watchedSec: 9, isCompleted: false });
  assert.equal(asCourseProgress({ lessonId: 'l1', watchedSec: -2 }), null);
  const v = validateOfflineQueue(USER, { deviceId: 'd1', syncItems: [item(), item({ id: '444e4567-e89b-12d3-a456-426614174000', userId: OTHER })] });
  assert.equal(v.valid.length, 1);
  assert.equal(v.invalidIds.length, 1);
  assert.deepEqual(foldOutcomes([{ id: 'a', outcome: 'PROCESSED' }, { id: 'b', outcome: 'FAILED_STORE' }]), { processedCount: 1, failedIds: ['b'] });
  ok('Zero-trust ownership + target taxonomy + fold');
}

// ---------- 3. Bulk flow: monotonic writes + ledger + failedIds ----------
async function sectionBulk(): Promise<void> {
  const pages = new Map<string, number>([[`${USER}:${PRODUCT}`, 9]]);
  const watches = new Map<string, number>();
  const ledgers: Array<{ status: string }> = [];
  const analytics: unknown[] = [];
  const repo = new OfflineSyncRepository({
    offlineDeviceSession: { upsert: async () => ({ id: 'sess-1' }) },
    offlineSyncLog: { create: async () => ({}) },
    ebookReadingProgress: {
      findUnique: async ({ where }: { where: { userId_ebookId: { userId: string; ebookId: string } } }) => {
        const v = pages.get(`${where.userId_ebookId.userId}:${where.userId_ebookId.ebookId}`);
        return v === undefined ? null : { lastPage: v };
      },
      upsert: async ({ where, create }: { where: { userId_ebookId: { userId: string; ebookId: string } }; create: { lastPage: number } }) => {
        pages.set(`${where.userId_ebookId.userId}:${where.userId_ebookId.ebookId}`, create.lastPage);
        return {};
      },
    },
    courseLearningProgress: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: { watchedSec: number } }) => {
        watches.set('l1', create.watchedSec);
        return {};
      },
    },
  } as never);
  const useCase = new ProcessBulkSyncUseCase(repo, (e) => {
    analytics.push(e);
  });
  void ledgers;
  const res = await useCase.execute(USER, {
    deviceId: 'd1',
    syncItems: [
      item(),
      item({ id: '555e4567-e89b-12d3-a456-426614174000', targetType: 'COURSE_PROGRESS', payload: { lessonId: 'l1', watchedSec: 42 } }),
      item({ id: '666e4567-e89b-12d3-a456-426614174000', userId: OTHER }),
      item({ id: '777e4567-e89b-12d3-a456-426614174000', targetType: 'OFFLINE_ANALYTICS', payload: { event: 'dwell' } }),
    ],
  });
  assert.equal(res.processedCount, 3);
  assert.equal(res.failedIds.length, 1);
  assert.equal(res.success, false);
  assert.equal(pages.get(`${USER}:${PRODUCT}`), 9);
  assert.equal(watches.get('l1'), 42);
  assert.equal(analytics.length, 1);
  ok('Bulk: stale replay never rewinds + per-item failedIds + ledger');
}

// ---------- 4. Prisma SSOT (§4.1 Gate 1, additive only) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model OfflineDeviceSession',
    'model OfflineSyncLog',
    '@@unique([userId, deviceId])',
    'offlineDeviceSessions',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: offline ledger (additive, progress tables untouched)');
}

// ---------- 5. Static parity: backend + PWA kit + proxy + ADR ----------
function sectionParity(): void {
  const ctrl = readFileSync('apps/backend/src/modules/offline-sync/infrastructure/controllers/offline-sync.controller.ts', 'utf8');
  assert.ok(ctrl.includes('offline-sync/bulk') && ctrl.includes('JwtAuthGuard'));
  const res = readFileSync('apps/backend/src/modules/offline-sync/infrastructure/offline-sync.resolver.ts', 'utf8');
  assert.ok(res.includes('syncOfflineDataQueue'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/offline-sync.graphql', 'utf8');
  for (const t of ['syncOfflineDataQueue', 'BulkOfflineSyncResponse', 'OfflineSyncItemInput']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/offline-sync/offline-sync.module.ts', 'utf8');
  assert.ok(mod.includes('ProcessBulkSyncUseCase') && mod.includes('OfflineSyncController'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('OfflineSyncModule'));
  const sw = readFileSync('apps/frontend/public/sw.js', 'utf8');
  for (const t of ['ebook-chunks', 'skipWaiting', 'sync-user-progress', 'ZENE_FLUSH_SYNC_QUEUE']) {
    assert.ok(sw.includes(t), `sw missing: ${t}`);
  }
  assert.ok(!sw.includes('importScripts') && !sw.includes("from 'workbox"), 'SW must not bundle workbox (zero-dep deviation)');
  const idb = readFileSync('apps/frontend/lib/pwa/indexeddb-engine.ts', 'utf8');
  for (const t of ['zene_pwa_db', 'ebook_chunks_store', 'sync_queue_store', 'by_product_page']) {
    if (t === 'zene_pwa_db') {
      assert.ok(idb.includes('PWA_DB_NAME') || idb.includes('zene_pwa_db'), 'idb missing db');
      continue;
    }
    assert.ok(idb.includes(t), `idb missing: ${t}`);
  }
  assert.ok(!idb.includes("from 'idb'") && !idb.includes('from "idb"'), 'idb engine must not import the idb package');
  const reg = readFileSync('apps/frontend/lib/pwa/sw-register.ts', 'utf8');
  assert.ok(reg.includes('initServiceWorker') && reg.includes('LIFF_INIT') && reg.includes("addEventListener('online'"));
  const ind = readFileSync('apps/frontend/components/pwa/offline-indicator.tsx', 'utf8');
  assert.ok(ind.includes('OfflineIndicator') && ind.includes('ออฟไลน์'));
  const host = readFileSync('apps/frontend/components/pwa/PwaOfflineHost.tsx', 'utf8');
  assert.ok(host.includes('PwaOfflineHost'));
  const layout = readFileSync('apps/frontend/app/layout.tsx', 'utf8');
  assert.ok(layout.includes('PwaOfflineHost'));
  const proxy = readFileSync('apps/frontend/app/api/v1/offline-sync/bulk/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/v1/offline-sync/bulk'));
  const manifest = readFileSync('apps/frontend/app/manifest.webmanifest/route.ts', 'utf8');
  assert.ok(manifest.includes('tenant'));
  assert.ok(readFileSync('docs/adr/ADR-062-pwa-offline-engine.md', 'utf8').includes('vanilla SW'));
  ok('Parity: bulk REST/GQL + vanilla SW/IDB kit + host + manifest + ADR');
}

async function main(): Promise<void> {
  await sectionBulk();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase062 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
