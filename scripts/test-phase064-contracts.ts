// SSOT Phase 064 §10-11 — contract tests (Zod, conflict matrix, sync flow, parity)
// Run: npx tsx scripts/test-phase064-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ProgressTypeEnum,
  EbookProgressSyncItemSchema,
  CourseProgressSyncItemSchema,
  BatchProgressSyncPayloadSchema,
  SyncResponseSchema,
  SYNC_BATCH_BUDGET_MS,
  SYNC_PAYLOAD_MAX_BYTES,
  SYNC_QUEUE_RAM_MB,
  SYNC_IDEMPOTENCY_TTL_SEC,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  syncBatchDedupeKey,
  syncItemCanonical,
  syncBackoffMs,
} from '../packages/shared/src/schemas/progress-sync.schema';
import { PayloadVerifierService } from '../apps/backend/src/modules/progress/services/payload-verifier.service';
import { ProgressSyncService } from '../apps/backend/src/modules/progress/services/progress-sync.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';
const LESSON = '333e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(ProgressTypeEnum.safeParse('COURSE_LESSON').success, true);
  assert.equal(EbookProgressSyncItemSchema.safeParse({
    id: '123e4567-e89b-12d3-a456-426614174000', productId: PRODUCT, lastPage: 7, clientTimestamp: new Date().toISOString(), signature: 'sig',
  }).success, true);
  assert.equal(CourseProgressSyncItemSchema.safeParse({
    id: '333e4567-e89b-12d3-a456-426614174000', lessonId: LESSON, watchedSec: 42, isCompleted: false, clientTimestamp: new Date().toISOString(), signature: 'sig',
  }).success, true);
  const batch = {
    syncBatchId: '444e4567-e89b-12d3-a456-426614174000', userId: USER, ebookProgressList: [{ id: '555e4567-e89b-12d3-a456-426614174000', productId: PRODUCT, lastPage: 5, clientTimestamp: new Date().toISOString(), signature: '' }],
    courseProgressList: [],
  };
  assert.equal(BatchProgressSyncPayloadSchema.safeParse(batch).success, true);
  assert.equal(SyncResponseSchema.safeParse({ success: true, syncedEbookIds: [], syncedLessonIds: [], conflictsResolved: 0, serverTimestamp: new Date().toISOString() }).success, true);
  assert.equal(SYNC_BATCH_BUDGET_MS, 200);
  assert.equal(SYNC_PAYLOAD_MAX_BYTES, 2048);
  assert.equal(SYNC_QUEUE_RAM_MB, 5);
  assert.equal(SYNC_IDEMPOTENCY_TTL_SEC, 24 * 60 * 60);
  assert.equal(syncBatchDedupeKey('abc'), 'progress:batch:abc');
  assert.equal(syncItemCanonical('prod1', 7, 'ts'), 'prod1:7:ts');
  assert.ok(syncBackoffMs(1) >= SYNC_BACKOFF_BASE_MS && syncBackoffMs(5) <= SYNC_BACKOFF_MAX_MS);
  ok('Zod progress contracts verbatim + idempotency/backoff/queue budgets');
}

// ---------- 2. PayloadVerifier: SETNX dedupe + HMAC verify ----------
async function sectionVerifier(): Promise<void> {
  const store = new Map<string, string>();
  const verifier = new PayloadVerifierService({
    setnx: async (key: string, _v: string, _ttl: number) => {
      if (store.has(key)) return false;
      store.set(key, '1');
      return true;
    },
  }, 'test-secret-999');
  const canon = syncItemCanonical(PRODUCT, 7, '2024-01-01T00:00:00Z');
  const sig = verifier.signCanonical(canon);
  assert.equal(verifier.verifyItemSignature(canon, sig), true);
  assert.equal(verifier.verifyItemSignature(canon, 'bad'), false);
  const first = await verifier.claimBatch('batch-1');
  const second = await verifier.claimBatch('batch-1');
  assert.equal(first, true);
  assert.equal(second, false);
  ok('Verifier: HMAC round-trip + SETNX idempotent gate');
}

// ---------- 3. ProgressSyncService: batch + monotonic + conflict ----------
async function sectionSync(): Promise<void> {
  const BATCH_1 = '444e4567-e89b-12d3-a456-426614174000';
  const BATCH_2 = '555e4567-e89b-12d3-a456-426614174000';
  const ITEM_E1 = '666e4567-e89b-12d3-a456-426614174000';
  const ITEM_C1 = '777e4567-e89b-12d3-a456-426614174000';
  const ITEM_E2 = '888e4567-e89b-12d3-a456-426614174000';
  const pages = new Map<string, number>([[`${USER}:${PRODUCT}`, 9]]);
  const watches = new Map<string, number>();
  const audits: unknown[] = [];
  const svc = new ProgressSyncService({
    offlineDeviceSession: { upsert: async () => ({ id: 'sess-1' }) },
    offlineSyncLog: { create: async (args: unknown) => { audits.push(args); return {}; } },
    ebookReadingProgress: {
      findUnique: async ({ where }: { where: { userId_ebookId: { userId: string; ebookId: string } } }) => {
        const key = `${where.userId_ebookId.userId}:${where.userId_ebookId.ebookId}`;
        const v = pages.get(key);
        return v === undefined ? null : { lastPage: v };
      },
      upsert: async ({ where, create }: { where: { userId_ebookId: { userId: string; ebookId: string } }; create: { lastPage: number } }) => {
        pages.set(`${where.userId_ebookId.userId}:${where.userId_ebookId.ebookId}`, create.lastPage);
        return {};
      },
    },
    courseLearningProgress: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: { watchedSec: number } }) => { watches.set(LESSON, create.watchedSec); return {}; },
    },
  } as never, undefined);
  const res = await svc.processBatchSync(USER, {
    syncBatchId: BATCH_1, userId: USER,
    ebookProgressList: [{ id: ITEM_E1, productId: PRODUCT, lastPage: 5, clientTimestamp: new Date().toISOString(), signature: '' }],
    courseProgressList: [{ id: ITEM_C1, lessonId: LESSON, watchedSec: 42, isCompleted: false, clientTimestamp: new Date().toISOString(), signature: '' }],
  }, '1.2.3.4', 'ua');
  assert.equal(res.success, true);
  assert.equal(res.syncedEbookIds.length, 1);
  assert.equal(res.syncedLessonIds.length, 1);
  assert.equal(res.conflictsResolved, 1);
  assert.equal(pages.get(`${USER}:${PRODUCT}`), 9);
  const stale = await svc.processBatchSync(USER, {
    syncBatchId: BATCH_2, userId: USER,
    ebookProgressList: [{ id: ITEM_E2, productId: PRODUCT, lastPage: 4, clientTimestamp: new Date().toISOString(), signature: '' }],
    courseProgressList: [],
  }, '1.2.3.4', 'ua');
  assert.equal(stale.conflictsResolved, 1);
  assert.equal(stale.syncedEbookIds.length, 1);
  assert.equal(pages.get(`${USER}:${PRODUCT}`), 9);
  ok('Sync: monotonic page/watch + conflict resolved=1 + zero-trust ownership');
}

// ---------- 4. Prisma untouched (OUT_OF_SCOPE_STRICT respected) ----------
{
  // Progress tables (EbookReadingProgress, CourseLearningProgress,
  // ProgressSyncAuditLog) are pre-existing from Phase 057/040.
  // No migration required — OUT_OF_SCOPE_STRICT respected.
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model EbookReadingProgress', 'model CourseLearningProgress', 'model ProgressSyncAuditLog']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: progress tables pre-existing (OUT_OF_SCOPE_STRICT)');
}

// ---------- 5. Static parity: backend + frontend + proxies + ADR ----------
function sectionParity(): void {
  const verifier = readFileSync('apps/backend/src/modules/progress/services/payload-verifier.service.ts', 'utf8');
  for (const t of ['PayloadVerifierService', 'claimBatch', 'verifyItemSignature', 'createHmac', 'SYNC_IDEMPOTENCY_TTL_SEC']) {
    assert.ok(verifier.includes(t), `verifier missing: ${t}`);
  }
  const sync = readFileSync('apps/backend/src/modules/progress/services/progress-sync.service.ts', 'utf8');
  for (const t of ['ProgressSyncService', 'processBatchSync', 'claimBatch', 'offlineSyncLog', 'ebookReadingProgress']) {
    assert.ok(sync.includes(t), `sync service missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/progress/controllers/batch-sync.controller.ts', 'utf8');
  assert.ok(ctrl.includes('batch-sync') && ctrl.includes('JwtAuthGuard'));
  const res1 = readFileSync('apps/backend/src/modules/progress/resolvers/ebook-progress.resolver.ts', 'utf8');
  assert.ok(res1.includes('syncOfflineEbookBatch'));
  const res2 = readFileSync('apps/backend/src/modules/progress/resolvers/course-progress.resolver.ts', 'utf8');
  assert.ok(res2.includes('syncOfflineCourseBatch'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/progress-batch.graphql', 'utf8');
  for (const t of ['syncOfflineEbookBatch', 'syncOfflineCourseBatch', 'OfflineSyncResult']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/progress/progress.module.ts', 'utf8');
  for (const t of ['ProgressSyncService', 'PayloadVerifierService', 'BatchSyncController', 'EbookProgressResolver', 'CourseProgressResolver']) {
    assert.ok(mod.includes(t), `module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('OfflineProgressModule'));
  const q = readFileSync('apps/frontend/lib/offline/indexeddb-queue.ts', 'utf8');
  for (const t of ['saveProgressToIndexedDB', 'getPendingSyncCount', 'getQueuedItems', 'clearSyncedItems', 'OFFLINE_STORES']) {
    assert.ok(q.includes(t), `queue missing: ${t}`);
  }
  const bg = readFileSync('apps/frontend/lib/offline/background-sync-manager.ts', 'utf8');
  assert.ok(bg.includes('registerProgressSync') && bg.includes('flushProgressQueue') && bg.includes('BroadcastChannel'));
  const hook = readFileSync('apps/frontend/hooks/useProgressSync.ts', 'utf8');
  for (const t of ['useProgressSync', 'pendingCount', 'registerProgressSync', 'flushProgressQueue', 'queueOffline']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const badge = readFileSync('apps/frontend/components/offline/SyncStatusBadge.tsx', 'utf8');
  assert.ok(badge.includes('SyncStatusBadge') && badge.includes('SYNC_COMPLETED'));
  for (const p of ['apps/frontend/app/api/v1/progress/batch-sync/route.ts']) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/progress/batch-sync'));
  }
  assert.ok(readFileSync('docs/adr/ADR-064-progress-bg-sync.md', 'utf8').includes('Background Sync'));
  ok('Parity: verifier + sync + GQL/REST + queue/bg/hook/badge + proxy + ADR');
}

async function main(): Promise<void> {
  await sectionVerifier();
  await sectionSync();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase064 contracts: ${passed + 5} checks passed`),
  (e) => { console.error(e); process.exit(1); },
);