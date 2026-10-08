// SSOT Phase 063 §10-11 — contract tests (Zod, lease math, services, parity)
// Run: npx tsx scripts/test-phase063-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OfflineStorageTypeEnum,
  SyncStatusEnum,
  DrmLeaseTokenSchema,
  OfflineEbookChunkSchema,
  OfflineVideoSegmentSchema,
  OfflineProgressSyncPayloadSchema,
  OFFLINE_LEASE_DAYS,
  OFFLINE_LEASE_RENEW_WITHIN_MS,
  OFFLINE_QUOTA_WARN_MB,
  OFFLINE_PREFETCH_CONCURRENCY,
  OFFLINE_DB_NAME,
  leaseExpiringSoon,
  leaseIsUsable,
  quotaWarnNeeded,
} from '../packages/shared/src/schemas/offline-sync.schema';
import { DrmLeaseService } from '../apps/backend/src/modules/offline/services/drm-lease.service';
import { OfflineSyncService } from '../apps/backend/src/modules/offline/services/offline-sync.service';
import { IssueLeaseDtoSchema } from '../apps/backend/src/modules/offline/dto/issue-lease.dto';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(OfflineStorageTypeEnum.safeParse('VIDEO_SEGMENT').success, true);
  assert.equal(SyncStatusEnum.safeParse('SYNCED').success, true);
  assert.equal(SyncStatusEnum.safeParse('LOST').success, false);
  const lease = {
    leaseId: USER, userId: USER, productId: PRODUCT, cryptoKeyHash: 'abc123',
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), signature: 'sig',
  };
  assert.equal(DrmLeaseTokenSchema.safeParse(lease).success, true);
  assert.equal(
    OfflineEbookChunkSchema.safeParse({ productId: PRODUCT, pageNumber: 1, encryptedSvgData: '<svg/>', iv: '', chunkSizeByte: 7, updatedAt: 1 }).success,
    true,
  );
  assert.equal(
    OfflineVideoSegmentSchema.safeParse({ courseId: 'c', lessonId: 'l', segmentName: 'segment_001.ts', encryptedArrayBuffer: new ArrayBuffer(8), segmentIndex: 1, updatedAt: 1 }).success,
    true,
  );
  assert.equal(OfflineVideoSegmentSchema.safeParse({ courseId: 'c', lessonId: 'l', segmentName: 's', encryptedArrayBuffer: 'nope', segmentIndex: 1, updatedAt: 1 }).success, false);
  const syncPayload = { userId: USER, ebookProgress: [{ productId: PRODUCT, lastPage: 25, timestamp: 1 }], courseProgress: [{ lessonId: 'l', watchedSec: 600, isCompleted: false, timestamp: 1 }] };
  assert.equal(OfflineProgressSyncPayloadSchema.safeParse(syncPayload).success, true);
  assert.equal(OFFLINE_LEASE_DAYS, 7);
  assert.equal(OFFLINE_LEASE_RENEW_WITHIN_MS, 24 * 60 * 60 * 1000);
  assert.equal(OFFLINE_QUOTA_WARN_MB, 50);
  assert.equal(OFFLINE_PREFETCH_CONCURRENCY, 5);
  assert.equal(OFFLINE_DB_NAME, 'AhongOfflineOmniCacheDB');
  assert.equal(leaseIsUsable(Date.now() + 1000), true);
  assert.equal(leaseIsUsable(Date.now() - 1000), false);
  assert.equal(leaseExpiringSoon(Date.now() + 3600000), true);
  assert.equal(leaseExpiringSoon(Date.now() + 7 * 86400000), false);
  assert.equal(quotaWarnNeeded(49), true);
  assert.equal(quotaWarnNeeded(51), false);
  assert.equal(IssueLeaseDtoSchema.safeParse({ productId: PRODUCT, deviceId: 'd1', clientPublicKey: 'k' }).success, true);
  ok('Zod offline contracts verbatim + lease/quota/prefetch budgets');
}

// ---------- 2. Lease service: gate + idempotent issue + verify ----------
async function sectionLease(): Promise<void> {
  const rows = new Map<string, { leaseToken: string; expiresAt: Date; revoked: boolean }>();
  const svc = new DrmLeaseService(
    {
      entitlement: { findUnique: async () => ({ expiresAt: null }) },
      drmOfflineLease: {
        findUnique: async ({ where }: { where: { userId_productId_deviceId: { userId: string } } }) =>
          rows.get(where.userId_productId_deviceId.userId) ?? null,
        upsert: async ({ create }: { create: { userId: string; leaseToken: string; expiresAt: Date } }) => {
          rows.set(create.userId, { leaseToken: create.leaseToken, expiresAt: create.expiresAt, revoked: false });
          return rows.get(create.userId) as { leaseToken: string; expiresAt: Date; revoked: boolean };
        },
      },
    } as never,
    'unit-secret-999',
  );
  const first = await svc.issueOfflineLease(USER, PRODUCT, 'd1', 'pubkey');
  assert.ok(first.leaseToken.length > 0);
  const second = await svc.issueOfflineLease(USER, PRODUCT, 'd1', 'pubkey');
  assert.equal(second.leaseToken, first.leaseToken);
  assert.equal((await svc.verifyLeaseToken(first.leaseToken)).valid, true);
  assert.equal((await svc.verifyLeaseToken('bogus')).valid, false);
  const tampered = Buffer.from(JSON.stringify({ payload: '{}', signature: '00' })).toString('base64');
  assert.equal((await svc.verifyLeaseToken(tampered)).valid, false);

  const denied = new DrmLeaseService(
    {
      entitlement: { findUnique: async () => null },
      drmOfflineLease: { findUnique: async () => null, upsert: async () => ({ leaseToken: 'x', expiresAt: new Date(), revoked: false }) },
    } as never,
  );
  await assert.rejects(denied.issueOfflineLease(USER, PRODUCT, 'd1', 'k'), /entitlement/);
  ok('Lease: entitlement gate + idempotent 7d issue + HMAC verify');
}

// ---------- 3. Sync service: monotonic flush + audit ----------
async function sectionSync(): Promise<void> {
  const pages = new Map<string, number>([[`${USER}:${PRODUCT}`, 30]]);
  const audits: unknown[] = [];
  const svc = new OfflineSyncService({
    offlineDeviceSession: { upsert: async () => ({ id: 'sess-9' }) },
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
      upsert: async () => ({}),
    },
    offlineSyncLog: { create: async (args: unknown) => { audits.push(args); return {}; } },
  } as never);
  const res = await svc.processOfflineSync(USER, {
    userId: USER,
    ebookProgress: [{ productId: PRODUCT, lastPage: 25, timestamp: 1 }],
    courseProgress: [{ lessonId: 'l9', watchedSec: 600, isCompleted: true, timestamp: 1 }],
  }, '1.2.3.4');
  assert.equal(res.success, true);
  assert.equal(res.syncedRecords, 2);
  assert.equal(pages.get(`${USER}:${PRODUCT}`), 30);
  assert.equal(audits.length, 1);
  const bad = await svc.processOfflineSync(USER, { nope: true }, '1.2.3.4');
  assert.equal(bad.success, false);
  ok('Sync: stale replay kept + audit row + Zod gate');
}

// ---------- 4. Prisma SSOT (§4.1 Gate 1, additive only) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model DrmOfflineLease',
    '@@unique([userId, productId, deviceId])',
    'drmOfflineLeases',
    'offlineSyncAudits',
    'syncedRecords',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: DrmOfflineLease + audit cols (additive)');
}

// ---------- 5. Static parity: backend + offline kit + proxies + ADR ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/offline/services/drm-lease.service.ts', 'utf8');
  for (const t of ['DrmLeaseService', 'issueOfflineLease', 'verifyLeaseToken', 'createHmac', 'drmOfflineLease']) {
    assert.ok(svc.includes(t), `lease service missing: ${t}`);
  }
  const sync = readFileSync('apps/backend/src/modules/offline/services/offline-sync.service.ts', 'utf8');
  assert.ok(sync.includes('processOfflineSync') && sync.includes('offlineSyncLog'));
  const ctrl = readFileSync('apps/backend/src/modules/offline/controllers/drm-lease.controller.ts', 'utf8');
  assert.ok(ctrl.includes('lease/issue') && ctrl.includes('lease/sync'));
  const mod = readFileSync('apps/backend/src/modules/offline/offline.module.ts', 'utf8');
  assert.ok(mod.includes('DrmLeaseService') && mod.includes('OfflineSyncService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('OfflineModule'));
  const schema = readFileSync('apps/frontend/lib/offline/indexeddb-schema.ts', 'utf8');
  for (const t of ['AhongOfflineOmniCacheDB', 'ebookChunks', 'videoSegments', 'drmLeases', 'pendingSyncRecords']) {
    assert.ok(schema.includes(t), `idb schema missing: ${t}`);
  }
  assert.ok(!schema.includes("from 'dexie'") && !schema.includes('from "dexie"'), 'must not import dexie');
  const mgr = readFileSync('apps/frontend/lib/offline/offline-manager.ts', 'utf8');
  for (const t of ['downloadProductForOffline', 'ensureOfflineLease', 'OFFLINE_PREFETCH_CONCURRENCY', 'evictOldestChunks', 'quotaWarn']) {
    assert.ok(mgr.includes(t), `manager missing: ${t}`);
  }
  const sw = readFileSync('apps/frontend/public/service-worker.js', 'utf8');
  for (const t of ['hls-offline-stream', 'videoSegments', 'skipWaiting']) {
    assert.ok(sw.includes(t), `service-worker missing: ${t}`);
  }
  assert.ok(!sw.includes('importScripts') && !sw.includes("require('dexie')"), 'SW must not load dexie');
  const reader = readFileSync('apps/frontend/components/reader/OfflineCanvasReader.tsx', 'utf8');
  for (const t of ['OfflineCanvasReader', 'LIFF_INIT', 'SUCCESS', 'ERROR', 'revokeObjectURL', 'OFFLINE LICENSED TO']) {
    assert.ok(reader.includes(t), `offline reader missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/player/OfflineHlsPlayer.tsx', 'utf8');
  assert.ok(player.includes('OfflineHlsPlayer') && player.includes('hls-offline-stream'));
  const page = readFileSync('apps/frontend/app/(liff)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(page.includes('OfflineCanvasReader') && page.includes('offline'));
  for (const p of ['apps/frontend/app/api/v1/offline/lease/issue/route.ts', 'apps/frontend/app/api/v1/offline/lease/sync/route.ts']) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/offline/lease'), `${p} missing forward`);
  }
  assert.ok(readFileSync('docs/adr/ADR-063-offline-chunk-cache.md', 'utf8').includes('native IndexedDB'));
  ok('Parity: lease/sync backend + IDB kit + SW + readers + shelf + ADR');
}

async function main(): Promise<void> {
  await sectionLease();
  await sectionSync();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase063 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
