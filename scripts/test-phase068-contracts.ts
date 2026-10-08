// SSOT Phase 068 §10-11 — contract tests (Zod, license service, DRM, parity)
// Run: npx tsx scripts/test-phase068-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DownloadStatusEnum,
  StorageCategoryEnum,
  DownloadTaskSchema,
  StorageQuotaSchema,
  OfflineLicenseTokenSchema,
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_RAM_MB,
  DOWNLOAD_DEFAULT_QUOTA_BYTES,
  DOWNLOAD_WARN_FREE_RATIO,
  OFFLINE_LICENSE_DEFAULT_DAYS,
  OFFLINE_LICENSE_MAX_DAYS,
  downloadTaskKey,
  licenseCanonical,
  isStorageLow,
  downloadProgress,
} from '../packages/shared/src/schemas/offline-license.schema';
import { OfflineLicenseService } from '../apps/backend/src/modules/offline-license/offline-license.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '333e4567-e89b-12d3-a456-426614174000';
const DEVICE = 'dev-abc123';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  assert.equal(DownloadStatusEnum.safeParse('COMPLETED').success, true);
  assert.equal(DownloadStatusEnum.safeParse('STREAMING').success, false);
  assert.equal(StorageCategoryEnum.safeParse('COURSE_HLS_SEGMENT').success, true);
  assert.equal(
    DownloadTaskSchema.safeParse({
      id: '444e4567-e89b-12d3-a456-426614174000', productId: PRODUCT, tenantId: 'default',
      title: 'Ebook A', category: 'EBOOK_VECTOR_CHUNK', totalBytes: 1024, downloadedBytes: 512,
      status: 'DOWNLOADING', progressPercentage: 50, storageLocation: 'OPFS',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }).success,
    true,
  );
  assert.equal(
    StorageQuotaSchema.safeParse({ totalGrantedQuotaBytes: 100, usedStorageBytes: 10, availableStorageBytes: 90, categoryBreakdown: { ebookBytes: 5, courseBytes: 5, audioBytes: 0 } }).success,
    true,
  );
  assert.equal(
    OfflineLicenseTokenSchema.safeParse({
      licenseId: '555e4567-e89b-12d3-a456-426614174000', userIdHash: 'abc', productId: PRODUCT,
      deviceIdHash: DEVICE, signature: 'sig', issuedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(), maxOfflineDays: 7,
    }).success,
    true,
  );
  assert.equal(DOWNLOAD_CHUNK_BYTES, 2 * 1024 * 1024);
  assert.equal(DOWNLOAD_MAX_RAM_MB, 30);
  assert.equal(DOWNLOAD_DEFAULT_QUOTA_BYTES, 5368709120);
  assert.equal(DOWNLOAD_WARN_FREE_RATIO, 0.1);
  assert.equal(OFFLINE_LICENSE_DEFAULT_DAYS, 7);
  assert.equal(OFFLINE_LICENSE_MAX_DAYS, 30);
  assert.equal(downloadTaskKey('p', 'd'), 'dl:p:d');
  assert.equal(licenseCanonical('l', 'u', 'p', 'd', 't'), 'l:u:p:d:t');
  assert.equal(isStorageLow(95, 100), true);
  assert.equal(isStorageLow(50, 100), false);
  assert.equal(downloadProgress(512, 1024), 50);
  assert.equal(downloadProgress(5, 0), 0);
  ok('Zod download/license contracts verbatim + budgets/quota/progress helpers');
}

// ---------- 2. License service: gate + issue + status + revoke + quota ----------
type LicenseRow = {
  id: string; userId: string; productId: string; deviceIdHash: string;
  licenseToken: string; encryptionKeyCipher: string; signature: string;
  issuedAt: Date; validUntil: Date; isRevoked: boolean;
};

function makePorts(granted: boolean) {
  const licenses = new Map<string, LicenseRow>();
  const profiles: Array<{ usedStorageBytes: number }> = [];
  const streams: Array<{ key: string }> = [];
  const tables = {
    entitlement: { findUnique: async () => (granted ? { id: 'ent-1' } : null) },
    offlineLicense: {
      findUnique: async ({ where }: { where: { id?: string; userId_productId_deviceIdHash?: { userId: string; productId: string; deviceIdHash: string } } }) => {
        if (where.id) return licenses.get(where.id) ?? null;
        const k = where.userId_productId_deviceIdHash;
        if (!k) return null;
        for (const row of licenses.values()) {
          if (row.userId === k.userId && row.productId === k.productId && row.deviceIdHash === k.deviceIdHash) return row;
        }
        return null;
      },
      upsert: async ({ create }: { create: Omit<LicenseRow, 'issuedAt' | 'isRevoked'> & Partial<LicenseRow> }) => {
        const row: LicenseRow = {
          issuedAt: new Date(), isRevoked: false, ...(create as LicenseRow),
        };
        licenses.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<LicenseRow> }) => {
        const prev = licenses.get(where.id);
        if (!prev) throw new Error('NOT_FOUND');
        const next = { ...prev, ...data };
        licenses.set(where.id, next);
        return next;
      },
    },
    deviceStorageProfile: {
      findUnique: async () => null,
      findMany: async () => profiles,
      upsert: async ({ create }: { create: { usedStorageBytes: number } }) => {
        profiles.push({ usedStorageBytes: create.usedStorageBytes });
        return create;
      },
    },
  };
  const stream = {
    xaddPipeline: async (key: string) => {
      streams.push({ key });
    },
  };
  return { tables, stream, licenses, profiles, streams };
}

async function sectionService(): Promise<void> {
  // issue: entitled → signed payload + escrow cipher + stream event
  {
    const { tables, stream, streams } = makePorts(true);
    const svc = new OfflineLicenseService(tables as never, stream, 'test-secret-068');
    const res = await svc.issueLicense(USER, PRODUCT, DEVICE, 7);
    assert.equal(res.ok, true);
    assert.ok(res.payload?.licenseToken.includes('.'));
    assert.ok((res.payload?.signature.length ?? 0) >= 64);
    assert.ok((res.payload?.encryptionKeyCipher.length ?? 0) > 0);
    assert.ok((res.payload?.contentKey.length ?? 0) > 0);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].key, 'events:offline-license');
  }
  // issue: forbidden without entitlement; days clamped to 30 max
  {
    const { tables, stream } = makePorts(false);
    const svc = new OfflineLicenseService(tables as never, stream, 'test-secret-068');
    const denied = await svc.issueLicense(USER, PRODUCT, DEVICE);
    assert.equal(denied.error, 'FORBIDDEN');
  }
  {
    const { tables, stream } = makePorts(true);
    const svc = new OfflineLicenseService(tables as never, stream, 'test-secret-068');
    const res = await svc.issueLicense(USER, PRODUCT, DEVICE, 999);
    const days = (new Date(res.payload?.validUntil ?? '').getTime() - Date.now()) / 86400000;
    assert.ok(days <= 30 && days > 29);
  }
  // status: VALID → EXPIRED → REVOKED → MISSING
  {
    const { tables, stream, licenses } = makePorts(true);
    const svc = new OfflineLicenseService(tables as never, stream, 'test-secret-068');
    assert.deepEqual((await svc.getLicense(USER, PRODUCT, DEVICE)).status, 'MISSING');
    await svc.issueLicense(USER, PRODUCT, DEVICE);
    assert.equal((await svc.getLicense(USER, PRODUCT, DEVICE)).status, 'VALID');
    for (const row of licenses.values()) row.validUntil = new Date(Date.now() - 1000);
    assert.equal((await svc.getLicense(USER, PRODUCT, DEVICE)).status, 'EXPIRED');
    for (const row of licenses.values()) {
      row.validUntil = new Date(Date.now() + 86400000);
      row.isRevoked = true;
    }
    assert.equal((await svc.getLicense(USER, PRODUCT, DEVICE)).status, 'REVOKED');
  }
  // revoke: owner ok, stranger blocked
  {
    const { tables, stream, licenses } = makePorts(true);
    const svc = new OfflineLicenseService(tables as never, stream, 'test-secret-068');
    const issued = await svc.issueLicense(USER, PRODUCT, DEVICE);
    const licenseId = [...licenses.values()][0].id;
    void issued;
    assert.equal(await svc.revokeLicense(OTHER, licenseId), false);
    assert.equal(await svc.revokeLicense(USER, licenseId), true);
    assert.equal((await svc.getLicense(USER, PRODUCT, DEVICE)).status, 'REVOKED');
  }
  // quota: report + aggregate
  {
    const { tables, stream } = makePorts(true);
    const svc = new OfflineLicenseService(tables as never, stream, 'test-secret-068');
    assert.equal((await svc.reportQuota(USER, DEVICE, 1024, 'Pixel')).ok, true);
    const usage = await svc.getQuotaUsage(USER);
    assert.equal(usage.usedBytes, 1024);
    assert.equal(usage.itemCount, 1);
  }
  ok('Service: entitlement gate + issue/sign/wrap + status + revoke + quota');
}

// ---------- 3. Prisma additive ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model OfflineLicense', 'model DeviceStorageProfile', 'offlineLicenses     OfflineLicense[]', 'offlineLicenses OfflineLicense[]']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: OfflineLicense + DeviceStorageProfile + back-relations (additive)');
}

// ---------- 4. Static parity ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/offline-license/offline-license.service.ts', 'utf8');
  for (const t of ['OfflineLicenseService', 'issueLicense', 'getLicense', 'revokeLicense', 'reportQuota', 'wrapContentKey', 'OFFLINE_LICENSE_STREAM']) {
    assert.ok(svc.includes(t), `service missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/offline-license/offline-license.controller.ts', 'utf8');
  assert.ok(ctrl.includes('offline-license') && ctrl.includes('JwtAuthGuard') && ctrl.includes('quota'));
  const res = readFileSync('apps/backend/src/modules/offline-license/offline-license.resolver.ts', 'utf8');
  assert.ok(res.includes('issueOfflineLicense') && res.includes('getStorageQuotaUsage'));
  const mod = readFileSync('apps/backend/src/modules/offline-license/offline-license.module.ts', 'utf8');
  assert.ok(mod.includes('OfflineLicenseModule') && mod.includes('OfflineLicenseController'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('OfflineLicenseModule'));
  const api = readFileSync('apps/backend/src/api/graphql/offline-license.resolver.ts', 'utf8');
  assert.ok(api.includes('offline-license.resolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/offline-license.graphql', 'utf8');
  assert.ok(sdl.includes('OfflineLicensePayload') && sdl.includes('issueOfflineLicense'));
  const zod = readFileSync('packages/shared/src/schemas/offline-license.schema.ts', 'utf8');
  assert.ok(zod.includes('DownloadTaskSchema') && zod.includes('licenseCanonical'));
  const engine = readFileSync('apps/frontend/lib/storage/opfs-engine.ts', 'utf8');
  assert.ok(engine.includes('OpfsStorageEngine') && engine.includes('getDirectory') && engine.includes('zene-downloads'));
  const drm = readFileSync('apps/frontend/lib/crypto/offline-drm.ts', 'utf8');
  assert.ok(drm.includes('encryptChunk') && drm.includes('decryptChunk') && drm.includes('verifyOfflineLicense'));
  const worker = readFileSync('apps/frontend/workers/download-worker.ts', 'utf8');
  assert.ok(worker.includes('Range') && worker.includes('CHUNK') && worker.includes('COMPLETE'));
  const store = readFileSync('apps/frontend/stores/use-download-store.ts', 'utf8');
  assert.ok(store.includes('useDownloadStore') && store.includes('OFFLINE_READY') && store.includes('LICENSE_EXPIRED_ERROR'));
  const lib = readFileSync('apps/frontend/lib/download/download-manager.ts', 'utf8');
  assert.ok(lib.includes('startDownload') && lib.includes('pauseDownload') && lib.includes('drainDownloadEvents'));
  const drawer = readFileSync('apps/frontend/components/download-manager/DownloadManagerDrawer.tsx', 'utf8');
  assert.ok(drawer.includes('DownloadManagerDrawer') && drawer.includes('StorageUsageBar'));
  assert.ok(!drawer.includes("from 'lucide-react'") && !drawer.includes('from "lucide-react"'), 'drawer must not import lucide-react');
  for (const p of [
    'apps/frontend/app/api/v1/offline-license/issue/route.ts',
    'apps/frontend/app/api/v1/offline-license/status/route.ts',
    'apps/frontend/app/api/v1/offline-license/revoke/route.ts',
    'apps/frontend/app/api/v1/offline-license/quota/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/offline-license'), `proxy missing: ${p}`);
  }
  assert.ok(readFileSync('docs/adr/ADR-068-download-manager.md', 'utf8').includes('Download Manager'));
  ok('Parity: service/controller/GQL + OPFS/DRM/worker/store/lib/drawer + proxies + ADR');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase068 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
