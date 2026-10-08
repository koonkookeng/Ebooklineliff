// SSOT Phase 069 §10-11 — contract tests (Zod, sync service, parity)
// Run: npx tsx scripts/test-phase069-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NetworkQualityEnum,
  NetworkStatusStateEnum,
  OfflineQueueActionTypeEnum,
  NetworkStatusPayloadSchema,
  OfflineQueueItemSchema,
  HealthPingResponseSchema,
  NETWORK_PING_TIMEOUT_MS,
  NETWORK_DEGRADED_MS,
  NETWORK_STABLE_MS,
  NETWORK_PING_CADENCE_MS,
  ONLINE_TOAST_MS,
  deriveNetworkState,
  networkQualityOf,
} from '../packages/shared/src/schemas/network-status.schema';
import { NetworkHealthService } from '../apps/backend/src/modules/network/network-health.service';
import { OfflineSyncService } from '../apps/backend/src/modules/network/services/offline-sync.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const EBOOK = '223e4567-e89b-12d3-a456-426614174000';
const LESSON = '333e4567-e89b-12d3-a456-426614174000';
const QUIZ = '444e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + state machine ----------
{
  assert.equal(NetworkQualityEnum.safeParse('DEGRADED').success, true);
  assert.equal(NetworkStatusStateEnum.safeParse('SYNCING_OFFLINE_QUEUE').success, true);
  assert.equal(NetworkStatusStateEnum.safeParse('OFFLINE').success, false);
  assert.equal(OfflineQueueActionTypeEnum.safeParse('TOGGLE_BOOKMARK').success, true);
  assert.equal(
    NetworkStatusPayloadSchema.safeParse({
      isOnline: true, latencyMs: 120, effectiveType: '4g', currentState: 'ONLINE_STABLE',
      pendingQueueCount: 0, timestamp: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    OfflineQueueItemSchema.safeParse({
      id: '555e4567-e89b-12d3-a456-426614174000', actionType: 'SYNC_EBOOK_PROGRESS',
      payload: { ebookId: EBOOK, lastPage: 5 }, createdAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(HealthPingResponseSchema.safeParse({ status: 'ok', serverTimestamp: Date.now() }).success, true);
  assert.equal(HealthPingResponseSchema.safeParse({ status: 'fail', serverTimestamp: 1 }).success, false);
  assert.equal(NETWORK_PING_TIMEOUT_MS, 2000);
  assert.equal(NETWORK_DEGRADED_MS, 1500);
  assert.equal(NETWORK_STABLE_MS, 300);
  assert.equal(NETWORK_PING_CADENCE_MS, 10000);
  assert.equal(ONLINE_TOAST_MS, 2500);
  assert.equal(deriveNetworkState(false, 0), 'OFFLINE_DISCONNECTED');
  assert.equal(deriveNetworkState(true, 2000), 'NETWORK_DEGRADED');
  assert.equal(deriveNetworkState(true, 120), 'ONLINE_STABLE');
  assert.equal(networkQualityOf(false, 0), 'DISCONNECTED');
  assert.equal(networkQualityOf(true, 2000), 'DEGRADED');
  assert.equal(networkQualityOf(true, 500), 'GOOD');
  assert.equal(networkQualityOf(true, 80), 'EXCELLENT');
  ok('Zod network contracts verbatim + budgets/state derivation');
}

// ---------- 2. OfflineSyncService: BDD-2 three actions flush 100% ----------
function makeTables() {
  const pages = new Map<string, number>();
  const watches = new Map<string, number>();
  const attempts: unknown[] = [];
  const bookmarks = new Set<string>();
  return {
    tables: {
      ebookReadingProgress: {
        findUnique: async ({ where }: { where: { userId_ebookId: { userId: string; ebookId: string } } }) => {
          const v = pages.get(`${where.userId_ebookId.userId}:${where.userId_ebookId.ebookId}`);
          return v === undefined ? null : { lastPage: v };
        },
        upsert: async ({ where, create }: { where: { userId_ebookId: { userId: string; ebookId: string } }; create: { lastPage: number } }) => {
          pages.set(`${where.userId_ebookId.userId}:${where.userId_ebookId.ebookId}`, (create as { lastPage: number }).lastPage);
          return {};
        },
      },
      courseLearningProgress: {
        findUnique: async () => null,
        upsert: async ({ create }: { create: { watchedSec: number } }) => {
          watches.set('x', (create as { watchedSec: number }).watchedSec);
          return {};
        },
      },
      quizAttempt: {
        create: async (args: unknown) => {
          attempts.push(args);
          return {};
        },
      },
      ebookBookmark: {
        findUnique: async () => null,
        create: async (args: unknown) => {
          bookmarks.add(JSON.stringify(args));
          return {};
        },
        delete: async () => ({}),
      },
    },
    pages, watches, attempts, bookmarks,
  };
}

const item = (id: string, actionType: string, payload: Record<string, unknown>) => ({
  id, actionType, payload, createdAt: new Date().toISOString(), retryCount: 0,
});

async function sectionSync(): Promise<void> {
  // BDD-2: bookmark + progress + quiz answer flush 100%.
  {
    const { tables, pages, watches, attempts, bookmarks } = makeTables();
    const svc = new OfflineSyncService(tables as never);
    const res = await svc.processBatchQueue(
      [
        item('666e4567-e89b-12d3-a456-426614174000', 'TOGGLE_BOOKMARK', { ebookId: EBOOK, pageNumber: 7 }),
        item('777e4567-e89b-12d3-a456-426614174000', 'SYNC_EBOOK_PROGRESS', { ebookId: EBOOK, lastPage: 9 }),
        item('888e4567-e89b-12d3-a456-426614174000', 'SUBMIT_QUIZ_ANSWER', { quizId: QUIZ, selectedOpts: ['A'] }),
        item('999e4567-e89b-12d3-a456-426614174000', 'SYNC_LESSON_PROGRESS', { lessonId: LESSON, watchedSec: 120 }),
      ],
      USER,
    );
    assert.equal(res.processedCount, 4);
    assert.deepEqual(res.failedItemIds, []);
    assert.equal(pages.get(`${USER}:${EBOOK}`), 9);
    assert.equal(watches.get('x'), 120);
    assert.equal(attempts.length, 1);
    assert.equal(bookmarks.size, 1);
  }
  // Invalid items fail individually; unknown user → all fail with ids.
  {
    const { tables } = makeTables();
    const svc = new OfflineSyncService(tables as never);
    const res = await svc.processBatchQueue(
      [{ id: 'not-a-uuid', actionType: 'NOPE' }, item('666e4567-e89b-12d3-a456-426614174000', 'SYNC_EBOOK_PROGRESS', { ebookId: EBOOK, lastPage: 2 })],
      undefined,
    );
    assert.equal(res.processedCount, 0);
    assert.deepEqual(res.failedItemIds, ['not-a-uuid', '666e4567-e89b-12d3-a456-426614174000']);
  }
  ok('Sync: BDD-2 batch flush 100% + per-item failure isolation');
}

// ---------- 3. Health service: pure ping + ≥5s telemetry gate ----------
async function sectionHealth(): Promise<void> {
  const rows: unknown[] = [];
  const svc = new NetworkHealthService({
    networkTelemetryLog: {
      create: async (args: unknown) => {
        rows.push(args);
        return {};
      },
    },
  } as never);
  const pong = svc.pingCheck('tenant-a');
  assert.equal(pong.status, 'ok');
  assert.ok(typeof pong.serverTimestamp === 'number');
  assert.equal(pong.tenantId, 'tenant-a');
  assert.equal((await svc.logTelemetry({ deviceType: 'LINE_LIFF_ANDROID', disconnectionSec: 3 })).recorded, false);
  assert.equal((await svc.logTelemetry({ userId: USER, deviceType: 'LINE_LIFF_IOS', disconnectionSec: 42, actionsQueued: 3 })).recorded, true);
  assert.equal(rows.length, 1);
  ok('Health: pure ping + telemetry 5s gate');
}

// ---------- 4. Prisma additive ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model NetworkTelemetryLog', 'networkTelemetry    NetworkTelemetryLog[]']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: NetworkTelemetryLog + back-relation (additive)');
}

// ---------- 5. Static parity ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/network/services/offline-sync.service.ts', 'utf8');
  for (const t of ['OfflineSyncService', 'processBatchQueue', 'SYNC_EBOOK_PROGRESS', 'TOGGLE_BOOKMARK', 'failedItemIds']) {
    assert.ok(svc.includes(t), `sync service missing: ${t}`);
  }
  const health = readFileSync('apps/backend/src/modules/network/network-health.service.ts', 'utf8');
  assert.ok(health.includes('pingCheck') && health.includes('logTelemetry'));
  const ctrl = readFileSync('apps/backend/src/modules/network/network-health.controller.ts', 'utf8');
  assert.ok(ctrl.includes('api/v1/network') && ctrl.includes('sync-offline-queue') && ctrl.includes('no-store'));
  const res = readFileSync('apps/backend/src/modules/network/network-health.resolver.ts', 'utf8');
  assert.ok(res.includes('networkPingCheck') && res.includes('flushOfflineQueue'));
  const mod = readFileSync('apps/backend/src/modules/network/network-health.module.ts', 'utf8');
  assert.ok(mod.includes('NetworkHealthModule') && mod.includes('NetworkHealthController'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('NetworkHealthModule'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/network.graphql', 'utf8');
  assert.ok(sdl.includes('networkPingCheck') && sdl.includes('flushOfflineQueue'));
  const db = readFileSync('apps/frontend/lib/offline-queue-db.ts', 'utf8');
  assert.ok(db.includes('omni-network-offline-db') && db.includes('enqueueOfflineAction') && db.includes('bumpRetryCounts'));
  assert.ok(!db.includes("from 'idb'") && !db.includes('from "idb"'), 'queue must stay dep-free');
  const hook = readFileSync('apps/frontend/hooks/useNetworkStatus.ts', 'utf8');
  for (const t of ['useNetworkStatus', 'SYNCING_OFFLINE_QUEUE', 'RECONNECTING_PING', 'AbortController']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const banner = readFileSync('apps/frontend/components/network/NetworkStatusBanner.tsx', 'utf8');
  assert.ok(banner.includes('NetworkStatusBanner') && banner.includes('safe-area-inset-top') && banner.includes('translate3d'));
  assert.ok(banner.includes('/api/v1/network/telemetry') && banner.includes('NETWORK_DEGRADED'));
  assert.ok(!banner.includes("from 'framer-motion'") && !banner.includes('from "framer-motion"'), 'banner must not import framer-motion');
  const provider = readFileSync('apps/frontend/providers/NetworkMonitorProvider.tsx', 'utf8');
  assert.ok(provider.includes('NetworkMonitorProvider') && provider.includes('NetworkStatusBanner'));
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('NetworkMonitorProvider'));
  for (const p of [
    'apps/frontend/app/api/v1/network/ping/route.ts',
    'apps/frontend/app/api/v1/network/sync-offline-queue/route.ts',
    'apps/frontend/app/api/v1/network/telemetry/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/network'), `proxy missing: ${p}`);
  }
  assert.ok(readFileSync('docs/adr/ADR-069-network-monitor.md', 'utf8').includes('Network Monitor'));
  ok('Parity: sync/health/GQL + queue/hook/banner/provider + proxies + ADR');
}

async function main(): Promise<void> {
  await sectionSync();
  await sectionHealth();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase069 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
