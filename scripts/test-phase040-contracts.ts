// SSOT Phase 040 §10 — contract tests (Zod, watermark, window, service, wiring)
// Run: npx tsx scripts/test-phase040-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  EbookChunkPayloadSchema,
  ForensicWatermarkSchema,
  ProgressSyncResultSchema,
  READER_CHUNK_TTL_SEC,
  READER_RAM_BUDGET_MB,
  READER_RAM_WARN_MB,
  READER_WINDOW_RADIUS,
  ReaderProgressPayloadSchema,
  readerEvictedPages,
  readerLegacyCacheKey,
  readerWindowPages,
} from '../packages/shared/src/schemas/reader.schema';
import {
  WATERMARK_HASH_LEN,
  WatermarkGeneratorService,
  hashUserId,
} from '../apps/backend/src/modules/reader/services/watermark-generator.service';
import { SlidingWindowCacheService } from '../apps/backend/src/modules/reader/services/sliding-window-cache.service';
import { ReaderService } from '../apps/backend/src/modules/reader/reader.service';
import { resolveReaderIdentity } from '../apps/backend/src/modules/reader/reader-identity';
import {
  RAM_BUDGET_MB,
  RAM_WARN_MB,
  estimateHeapMB,
  evictedPages,
  isOverBudget,
  isWarning,
  sweepOutsideWindow,
  windowFor,
} from '../apps/frontend/components/reader/utils/memoryManager';
import {
  clearQueuedProgress,
  loadChunkOffline,
  peekQueuedProgress,
  pruneOfflineOutside,
  queueProgressOffline,
  saveChunkForOffline,
} from '../apps/frontend/lib/reader/offline-chunk-cache';
// NOTE: ReaderController/ReaderResolver carry Nest parameter decorators
// (@Query/@Args/@Context) which tsx/esbuild cannot transform — identity logic
// lives in decorator-free reader-identity.ts (runtime-tested below); the rest
// is verified via static source parity (§8) following Phase 027–039 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  const wm = { watermarkText: 'LICENSED TO USER: user-001', userIdHash: 'abc123def456', timestamp: new Date().toISOString() };
  assert.equal(ForensicWatermarkSchema.safeParse(wm).success, true);
  assert.equal(ForensicWatermarkSchema.safeParse({ ...wm, userIdHash: '' }).success, false);
  assert.equal(ForensicWatermarkSchema.safeParse({ ...wm, timestamp: 'not-a-date' }).success, false);

  const chunk = {
    productId: PRODUCT_ID,
    pageNumber: 10,
    totalPages: 300,
    vectorSvgContent: '<svg><rect/></svg>',
    forensicWatermark: wm,
    hasPrevious: true,
    hasNext: true,
  };
  assert.equal(EbookChunkPayloadSchema.safeParse(chunk).success, true);
  assert.equal(EbookChunkPayloadSchema.safeParse({ ...chunk, productId: 'nope' }).success, false);
  assert.equal(EbookChunkPayloadSchema.safeParse({ ...chunk, pageNumber: 0 }).success, false);
  assert.equal(EbookChunkPayloadSchema.safeParse({ ...chunk, vectorSvgContent: '' }).success, false);

  const progress = { productId: PRODUCT_ID, lastPage: 10, readDurationSec: 45, timestamp: new Date().toISOString() };
  assert.equal(ReaderProgressPayloadSchema.safeParse(progress).success, true);
  assert.equal(ReaderProgressPayloadSchema.safeParse({ ...progress, readDurationSec: -1 }).success, false);
  assert.equal(ProgressSyncResultSchema.safeParse({ success: true, lastPage: 10, updatedAt: new Date().toISOString() }).success, true);

  assert.equal(READER_CHUNK_TTL_SEC, 86400);
  assert.equal(READER_RAM_BUDGET_MB, 30);
  assert.equal(READER_RAM_WARN_MB, 28);
  assert.equal(READER_WINDOW_RADIUS, 1);
  assert.equal(readerLegacyCacheKey(PRODUCT_ID, 10), `reader:chunk:${PRODUCT_ID}:10`);
  assert.deepEqual(readerWindowPages(10), [9, 10, 11]);
  assert.deepEqual(readerWindowPages(1), [1, 2]);
  assert.deepEqual(readerEvictedPages([9, 10, 11], [10, 11, 12]), [9]);
  assert.deepEqual(readerEvictedPages([9, 10, 11], [9, 10, 11]), []);
  ok('Zod watermark/chunk/progress/result verbatim + budgets + window math');
}

// ---------- 2. Watermark generator (§5.2/§8.2) ----------
{
  assert.equal(WATERMARK_HASH_LEN, 12);
  const h1 = hashUserId(USER_ID, 's3cret');
  assert.equal(h1, createHash('sha256').update(`${USER_ID}-s3cret`).digest('hex').slice(0, 12));
  assert.equal(h1.length, 12);
  assert.notEqual(hashUserId(USER_ID, 'other'), h1);
  assert.notEqual(hashUserId('user-002', 's3cret'), h1);

  const svc = new WatermarkGeneratorService();
  const payload = svc.forWatermark(USER_ID, 's3cret');
  assert.equal(payload.watermarkText, `LICENSED TO USER: ${USER_ID}`);
  assert.equal(payload.userIdHash, h1);
  assert.equal(ForensicWatermarkSchema.safeParse(payload).success, true);
  ok('sha256(userId-secret) 12-hex watermark, Zod-shaped, secret-bound');
}

// ---------- 3. memoryManager pure protocol (Task 40.5) ----------
{
  assert.equal(RAM_BUDGET_MB, 30);
  assert.equal(RAM_WARN_MB, 28);
  assert.deepEqual(windowFor(10), [9, 10, 11]);
  assert.deepEqual(evictedPages([9, 10, 11], [10, 11, 12]), [9]);
  assert.equal(estimateHeapMB(), null); // node has no performance.memory
  assert.equal(isOverBudget(null), false);
  assert.equal(isOverBudget(29.9), false);
  assert.equal(isOverBudget(30), true);
  assert.equal(isWarning(27.9), false);
  assert.equal(isWarning(28), true);

  const revoked: string[] = [];
  const realRevoke = URL.revokeObjectURL.bind(URL);
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
  try {
    const cache = new Map<number, string>([[9, 'a'], [10, 'b'], [11, 'c']]);
    const urls = new Map<number, string>([[9, 'blob:9'], [10, 'blob:10']]);
    const evicted = sweepOutsideWindow(cache, urls, [10, 11, 12]);
    assert.deepEqual(evicted, [9]);
    assert.deepEqual(revoked, ['blob:9']);
    assert.equal(cache.has(9), false);
    assert.equal(urls.has(10), true);
    assert.deepEqual(sweepOutsideWindow(new Map(), new Map(), [1, 2, 3]), []);
  } finally {
    URL.revokeObjectURL = realRevoke;
  }
  ok('Window/evict math + heap guards + blob-revocation sweep');
}

// ---------- 4. Offline cache fail-open (Task 40.6; node has no IndexedDB) ----------
async function offlineSection(): Promise<void> {
  assert.equal(await loadChunkOffline(PRODUCT_ID, 1), null);
  await saveChunkForOffline({
    productId: PRODUCT_ID,
    pageNumber: 1,
    totalPages: 300,
    vectorSvgContent: '<svg/>',
    forensicWatermark: { watermarkText: 't', userIdHash: 'h', timestamp: new Date().toISOString() },
    hasPrevious: false,
    hasNext: true,
  });
  await pruneOfflineOutside(PRODUCT_ID, [1, 2, 3]);
  await queueProgressOffline({ productId: PRODUCT_ID, lastPage: 5, readDurationSec: 10, queuedAt: new Date().toISOString() });
  assert.deepEqual(await peekQueuedProgress(), []);
  await clearQueuedProgress();
  ok('Offline cache fail-open without IDB (no throws, null/empty defaults)');
}

function fakeWarmer(pages: Map<number, string>) {
  return {
    getOrWarm: async (params: { pageNumber: number }) => {
      const svg = pages.get(params.pageNumber);
      if (!svg) return null;
      return {
        pageNumber: params.pageNumber,
        vectorSvgContent: svg,
        compressedSizeByte: svg.length,
        isEncrypted: true,
        cachedAt: new Date().toISOString(),
        ttlSeconds: 86400,
      };
    },
  };
}

async function main(): Promise<void> {
  await offlineSection();

  // ---------- 5. SlidingWindowCacheService (BDD-1/BDD-2 server mirror) ----------
  {
    const svc = new SlidingWindowCacheService(fakeWarmer(new Map([[9, '<svg>9</svg>'], [10, '<svg>10</svg>']])) as never);
    assert.deepEqual(svc.windowFor(10), [9, 10, 11]);
    const win = await svc.fetchWindow('t1', PRODUCT_ID, 10, [8, 9, 10]);
    assert.deepEqual(win.pages, [9, 10, 11]);
    assert.equal(win.chunks.size, 2); // page 11 missing upstream → skipped, never throws
    assert.deepEqual(win.evicted, [8]);

    const empty = new SlidingWindowCacheService();
    const win2 = await empty.fetchWindow('t1', PRODUCT_ID, 1);
    assert.equal(win2.chunks.size, 0);
    assert.deepEqual(win2.evicted, []);
    ok('Window fetch via warmer + eviction report + warmerless empty');
  }

  // ---------- 6. ReaderService entitlement/bounds/happy/progress (§5.2) ----------
  {
    const prisma = (opts: { entitled: boolean; totalPages: number | null }) => ({
      entitlement: {
        findUnique: async () => (opts.entitled ? { userId: USER_ID, productId: PRODUCT_ID } : null),
      },
      ebookDetail: {
        findUnique: async () =>
          opts.totalPages === null ? null : { productId: PRODUCT_ID, totalPages: opts.totalPages },
      },
      ebookReadingProgress: {
        upsert: async (args: unknown) => {
          const a = args as { create: { lastPage: number } };
          return { lastPage: a.create.lastPage, updatedAt: new Date('2026-10-07T00:00:00.000Z') };
        },
      },
    });
    const warmer = fakeWarmer(new Map([[10, '<svg>page-10</svg>']]));
    const wm = new WatermarkGeneratorService();

    // 403 without entitlement.
    const gated = new ReaderService(warmer as never, prisma({ entitled: false, totalPages: 300 }), wm, 's3cret');
    await assert.rejects(() => gated.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 10), /สิทธิ์/);

    // 404 unknown book / page overflow / missing chunk.
    const missing = new ReaderService(warmer as never, prisma({ entitled: true, totalPages: null }), wm, 's3cret');
    await assert.rejects(() => missing.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 1), /ไม่พบ/);
    const overflow = new ReaderService(warmer as never, prisma({ entitled: true, totalPages: 300 }), wm, 's3cret');
    await assert.rejects(() => overflow.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 301), /ไม่พบ/);
    await assert.rejects(() => overflow.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 11), /ไม่พบ/);

    // Happy path: watermarked, bounded, Zod-shaped.
    const svc = new ReaderService(warmer as never, prisma({ entitled: true, totalPages: 300 }), wm, 's3cret');
    const payload = await svc.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 10);
    assert.equal(EbookChunkPayloadSchema.safeParse(payload).success, true);
    assert.equal(payload.vectorSvgContent, '<svg>page-10</svg>');
    assert.equal(payload.totalPages, 300);
    assert.equal(payload.hasPrevious, true);
    assert.equal(payload.hasNext, true);
    assert.equal(payload.forensicWatermark.userIdHash, hashUserId(USER_ID, 's3cret'));
    const first = await svc.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 1).catch(() => null);
    assert.equal(first, null); // page 1 has no chunk upstream → 404 (checked: warmer lacks it)
    void first;

    // Progress: single upsert + dwell sink + fail-open unknown book.
    const events: unknown[] = [];
    const syncing = new ReaderService(warmer as never, prisma({ entitled: true, totalPages: 300 }), wm, 's3cret', (e) => {
      events.push(e);
    });
    const result = await syncing.syncEbookProgress(USER_ID, PRODUCT_ID, 10, 45);
    assert.equal(result.success, true);
    assert.equal(result.lastPage, 10);
    assert.equal(result.updatedAt, '2026-10-07T00:00:00.000Z');
    assert.deepEqual(events, [{ userId: USER_ID, productId: PRODUCT_ID, lastPage: 10, readDurationSec: 45 }]);

    const failOpen = new ReaderService(warmer as never, prisma({ entitled: true, totalPages: null }), wm, 's3cret');
    const r2 = await failOpen.syncEbookProgress(USER_ID, PRODUCT_ID, 7, 5);
    assert.equal(r2.lastPage, 7);

    // Unwired service fails closed with a typed error (never hangs).
    const bare = new ReaderService();
    await assert.rejects(() => bare.getEbookPageChunk(USER_ID, 't1', PRODUCT_ID, 1), /unavailable/);
    await assert.rejects(() => bare.syncEbookProgress(USER_ID, PRODUCT_ID, 1, 0), /unavailable/);
    ok('Entitlement 403 + bounds/chunk 404 + watermarked happy + progress upsert/sink/fail-open');
  }

  // ---------- 7. Resolver identity (decorator-free helper) ----------
  {
    assert.deepEqual(resolveReaderIdentity({ req: { user: { id: 'u1', tenantId: 't9' } } }), {
      userId: 'u1',
      tenantId: 't9',
    });
    assert.deepEqual(resolveReaderIdentity({ req: { user: { id: 'u1' } } }), {
      userId: 'u1',
      tenantId: 'default',
    });
    assert.throws(() => resolveReaderIdentity({}), /Missing session identity/);
    assert.throws(() => resolveReaderIdentity(undefined), /Missing session identity/);
    ok('Reader identity: JWT tenant preferred, default fallback, anonymous rejected');
  }

  // ---------- 8. Wiring + SDL/DTO/proxy/hook/component parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of ['model Entitlement', '@@unique([userId, productId])', 'model EbookDetail', 'model EbookReadingProgress', '@@unique([userId, ebookId])']) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['EbookChunkPayloadSchema', 'ReaderProgressPayloadSchema', 'readerWindowPages', 'readerEvictedPages']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    // Phase 039 tenant-default compat still holds ('' invalid, undefined → default).
    const { ChunkCacheKeyParamsSchema } = await import('../packages/shared/src/schemas/chunk-cache.schema');
    assert.equal(ChunkCacheKeyParamsSchema.safeParse({ productId: PRODUCT_ID, pageNumber: 1 }).success, true);
    assert.equal(ChunkCacheKeyParamsSchema.safeParse({ tenantId: '', productId: PRODUCT_ID, pageNumber: 1 }).success, false);

    const mod = readFileSync('apps/backend/src/modules/reader/reader.module.ts', 'utf8');
    for (const t of ['ReaderService', 'ReaderController', 'ReaderResolver', 'ChunkCacheModule', 'PrismaService', 'WatermarkGeneratorService', 'SlidingWindowCacheService', 'useFactory']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('ReaderModule'));
    const ctlSrc = readFileSync('apps/backend/src/modules/reader/reader.controller.ts', 'utf8');
    for (const t of ['api/v1/reader', '@Get', '@Post', 'JwtAuthGuard', 'getEbookPageChunk', 'syncEbookProgress', 'ReaderProgressPayloadSchema']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const rslSrc = readFileSync('apps/backend/src/modules/reader/reader.resolver.ts', 'utf8');
    for (const t of ['getEbookPageChunk', 'syncEbookProgress', 'EbookChunkPayload', 'ProgressSyncPayload', 'ForensicWatermarkPayload', '@Context', 'resolveReaderIdentity']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/reader.graphql/schema.graphql', 'utf8');
    for (const t of ['getEbookPageChunk', 'syncEbookProgress', 'EbookChunkPayload', 'ProgressSyncPayload', 'ForensicWatermarkPayload']) {
      assert.ok(sdl.includes(t), `SDL missing ${t}`);
    }
    const dto = readFileSync('apps/backend/src/modules/reader/dto/reader.dto.ts', 'utf8');
    assert.ok(dto.includes("from '@repo/shared'") && dto.includes('EbookChunkPayloadSchema'));
    const wmSvc = readFileSync('apps/backend/src/modules/reader/services/watermark-generator.service.ts', 'utf8');
    assert.ok(wmSvc.includes('sha256') && wmSvc.includes('LICENSED TO USER'));
    const proxy = readFileSync('apps/frontend/app/api/v1/reader/chunk/route.ts', 'utf8');
    for (const t of ['/api/v1/reader/chunk', 'authorization', '503']) {
      assert.ok(proxy.includes(t), `chunk proxy missing ${t}`);
    }
    const pProxy = readFileSync('apps/frontend/app/api/v1/reader/progress/route.ts', 'utf8');
    assert.ok(pProxy.includes('/api/v1/reader/progress') && pProxy.includes('POST'));
    const hook = readFileSync('apps/frontend/components/reader/hooks/useSlidingWindow.ts', 'utf8');
    for (const t of ['/api/v1/reader/chunk', 'activeChunks', 'isLoading', 'memoryUsageMB', 'loadChunkOffline', 'saveChunkForOffline']) {
      assert.ok(hook.includes(t), `hook missing ${t}`);
    }
    const mm = readFileSync('apps/frontend/components/reader/utils/memoryManager.ts', 'utf8');
    assert.ok(mm.includes('sweepOutsideWindow') && mm.includes('revokeObjectURL'));
    const off = readFileSync('apps/frontend/lib/reader/offline-chunk-cache.ts', 'utf8');
    for (const t of ['indexedDB', 'saveChunkForOffline', 'loadChunkOffline', 'queueProgressOffline', 'peekQueuedProgress']) {
      assert.ok(off.includes(t), `offline cache missing ${t}`);
    }
    const fw = readFileSync('apps/frontend/components/reader/watermark/ForensicWatermark.tsx', 'utf8');
    for (const t of ['watermarkText', 'userIdHash', 'aria-hidden', 'pointer-events-none']) {
      assert.ok(fw.includes(t), `watermark overlay missing ${t}`);
    }
    const canvas = readFileSync('apps/frontend/components/reader/CanvasReader.tsx', 'utf8');
    for (const t of ['ForensicWatermark', 'forensicWatermark', 'clearRect', 'revokeObjectURL', 'data-watermark']) {
      assert.ok(canvas.includes(t), `CanvasReader missing ${t}`);
    }
    ok('Prisma SSOT + barrel + module/App wiring + controller/resolver/SDL/DTO + proxies + hook/offline/watermark/canvas parity');
  }

  console.log(`\nPhase 040 contracts: ${passed} checks passed`);
}

void main();
