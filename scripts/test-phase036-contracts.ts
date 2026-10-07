// SSOT Phase 036 §10 — contract tests (Zod, SigV4, pipeline, guard, UI, wiring)
// Run: npx tsx scripts/test-phase036-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  StorageProviderEnum,
  MediaTypeEnum,
  R2ObjectMetadataSchema,
  EbookChunkFetchRequestSchema,
  HlsQualityEnum,
  HlsStreamSignedUrlRequestSchema,
  SignedStreamUrlResponseSchema,
  R2UploadRequestSchema,
  R2_DEFAULT_BUCKET,
  R2_CHUNK_CACHE_TTL_SEC,
  HLS_TOKEN_TTL_SEC,
  R2_PREVIEW_MAX_PAGE,
  HLS_LADDER,
  chunkObjectKey,
  hlsObjectPrefix,
  chunkCacheKey,
} from '../packages/shared/src/schemas/r2-storage-contract';
import { R2StorageService } from '../apps/backend/src/infra/cloudflare/r2-storage.service';
import { EbookChunkerService } from '../apps/backend/src/modules/reader/ebook-chunker.service';
import { HlsTranscoderService, buildMasterPlaylist, buildVariantPlaylist } from '../apps/backend/src/modules/stream/hls-transcoder.service';
import { EdgeStreamEntitlementGuard } from '../apps/backend/src/modules/entitlement/guards/edge-stream-entitlement.guard';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import { R2CanvasChunkFetcher } from '../apps/frontend/components/reader/r2-vector-fetcher';
// NOTE: MediaVaultController uses Nest parameter decorators (@Param/@Res) which
// tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–035 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod vault vocabulary + key layout (§3.1 Gate 1) ----------
{
  for (const p of ['CLOUDFLARE_R2', 'REDIS_EDGE_CACHE', 'LOCAL_MOCK']) assert.equal(StorageProviderEnum.safeParse(p).success, true);
  for (const m of ['EBOOK_VECTOR_CHUNK', 'HLS_PLAYLIST', 'HLS_SEGMENT', 'PRODUCT_COVER', 'PAYMENT_SLIP']) {
    assert.equal(MediaTypeEnum.safeParse(m).success, true);
  }
  assert.equal(R2ObjectMetadataSchema.safeParse({ bucketName: 'b', objectKey: 'k', contentLength: 10, contentType: 'image/svg+xml', eTag: 'e', sha256Hash: 's' }).success, true);
  assert.equal(EbookChunkFetchRequestSchema.safeParse({ productId: 'p', pageNumber: 42 }).success, true);
  assert.equal(EbookChunkFetchRequestSchema.safeParse({ productId: 'p', pageNumber: 0 }).success, false);
  assert.equal(EbookChunkFetchRequestSchema.safeParse({ productId: '', pageNumber: 1 }).success, false);
  for (const q of ['360p', '480p', '720p', '1080p', 'auto']) assert.equal(HlsQualityEnum.safeParse(q).success, true);
  assert.equal(HlsStreamSignedUrlRequestSchema.safeParse({ courseId: 'c', lessonId: 'l' }).success, true);
  assert.equal(SignedStreamUrlResponseSchema.safeParse({ playlistUrl: 'https://cdn.example.com/m.m3u8', streamToken: 'tokentok', expiresAt: new Date().toISOString() }).success, true);
  assert.equal(R2UploadRequestSchema.safeParse({ productId: 'p', fileName: 'a.pdf', fileSizeBytes: 10, mimeType: 'application/pdf', mediaType: 'EBOOK_VECTOR_CHUNK' }).success, true);
  assert.equal(R2UploadRequestSchema.safeParse({ productId: 'p', fileName: 'a.pdf', fileSizeBytes: 0, mimeType: 'application/pdf', mediaType: 'EBOOK_VECTOR_CHUNK' }).success, false);
  assert.equal(R2_DEFAULT_BUCKET, 'omni-commerce-vault');
  assert.equal(R2_CHUNK_CACHE_TTL_SEC, 86400);
  assert.equal(HLS_TOKEN_TTL_SEC, 60);
  assert.equal(R2_PREVIEW_MAX_PAGE, 10);
  assert.equal(HLS_LADDER.length, 4);
  assert.ok(HLS_LADDER.some((r) => r.resolution === '1080p' && r.bandwidth === 5200000));
  assert.equal(chunkObjectKey('PROD-1', 7), 'vault/ebooks/PROD-1/chunks/page-7.svg.enc');
  assert.equal(hlsObjectPrefix('LESSON-9'), 'vault/hls/LESSON-9/');
  assert.equal(chunkCacheKey('vault/ebooks/p/chunks/page-1.svg.enc'), 'r2:chunk:vault/ebooks/p/chunks/page-1.svg.enc');
  ok('Zod providers/media/meta/chunk/HLS/upload + ladder/TTL/keys');
}

const R2_ENV = { R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AKID', R2_SECRET_ACCESS_KEY: 'secret', R2_VAULT_BUCKET: 'vault-bucket' };

async function withR2Env<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(R2_ENV)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main(): Promise<void> {
// ---------- 2. SigV4 transport: presigned shapes + signed round-trip + 503 ----------
{
  const svc = new R2StorageService();
  // Unconfigured → explicit 503 (never a fabricated URL).
  for (const k of Object.keys(R2_ENV)) delete process.env[k];
  assert.throws(() => svc.config(), /not configured/);
  assert.throws(() => svc.presignedGetUrl('k', 60), /not configured/);

  await withR2Env(async () => {
    assert.equal(svc.config().bucket, 'vault-bucket');
    assert.equal(svc.endpointFor('acct123'), 'https://acct123.r2.cloudflarestorage.com');
    const get = svc.presignedGetUrl('vault/ebooks/p/chunks/page-1.svg.enc', 60);
    const url = new URL(get);
    assert.equal(url.host, 'acct123.r2.cloudflarestorage.com');
    assert.ok(url.pathname.includes('/vault-bucket/vault/ebooks/p/chunks/page-1.svg.enc'));
    assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
    assert.ok(/^X-Amz-Credential=AKID/.test(url.searchParams.toString()) || (url.searchParams.get('X-Amz-Credential') ?? '').startsWith('AKID/'));
    assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
    const put = svc.presignedPutUrl('vault/uploads/p/a.pdf', 'application/pdf', 3600);
    const putUrl = new URL(put);
    assert.match(putUrl.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
    assert.notEqual(putUrl.searchParams.get('X-Amz-Signature'), url.searchParams.get('X-Amz-Signature'));

    // Signed GET round-trip carries SigV4 headers; failures surface honestly.
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (u: unknown, init?: { headers?: Record<string, string> }) => {
      seen.push({ url: String(u), headers: init?.headers ?? {} });
      return { ok: true, text: async () => '<svg/>' } as unknown as Response;
    };
    assert.equal(await svc.getObjectText('vault/ebooks/p/chunks/page-1.svg.enc'), '<svg/>');
    assert.ok((seen[0].headers.Authorization ?? '').startsWith('AWS4-HMAC-SHA256 Credential=AKID/'));
    assert.ok(seen[0].headers['x-amz-date'] && seen[0].headers['x-amz-content-sha256']);
    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: false, status: 403, text: async () => '' });
    await assert.rejects(() => svc.getObjectText('vault/x.svg'), /R2 GET 403/);
    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, headers: { get: () => '"etag-1"' } });
    assert.deepEqual(await svc.putObject('vault/x.svg', '<svg/>', 'image/svg+xml'), { eTag: '"etag-1"' });
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  });
  for (const k of Object.keys(R2_ENV)) delete process.env[k];
  ok('SigV4 GET/PUT presign shapes + signed headers + honest failures + 503');
}

// ---------- 3. Chunker: plan/upload/verify (idempotent manifests) ----------
{
  const puts: string[] = [];
  const upserted: unknown[] = [];
  const fakeR2 = { putObject: async (k: string) => { puts.push(k); return { eTag: 'e' }; } } as unknown as R2StorageService;
  const prisma = {
    ebookDetail: { findFirst: async () => ({ id: 'ebook-1', productId: 'PROD-1', totalPages: 2 }) },
    ebookChunkMeta: {
      upsert: async (a: unknown) => { upserted.push(a); return {}; },
      count: async () => 2,
    },
  } as unknown as PrismaService;
  const svc = new EbookChunkerService(prisma, fakeR2);
  const plan = svc.planChunkManifest('PROD-1', [
    { pageNumber: 1, svgContent: '<svg>1</svg>' },
    { pageNumber: 2, svgContent: '<svg>2</svg>' },
  ]);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].r2ObjectKey, 'vault/ebooks/PROD-1/chunks/page-1.svg.enc');
  assert.equal(plan[0].vectorChecksum.length, 64);
  assert.throws(() => svc.planChunkManifest('', [{ pageNumber: 1, svgContent: 'x' }]), /Missing product/);
  assert.throws(() => svc.planChunkManifest('p', []), /No rendered pages/);
  assert.throws(() => svc.planChunkManifest('p', [{ pageNumber: 1, svgContent: 'x' }, { pageNumber: 1, svgContent: 'y' }]), /Duplicate/);
  assert.throws(() => svc.planChunkManifest('p', [{ pageNumber: -1, svgContent: 'x' }]), /Invalid page/);

  const out = await svc.uploadChunks('PROD-1', [
    { pageNumber: 1, svgContent: '<svg>1</svg>' },
    { pageNumber: 2, svgContent: '<svg>2</svg>' },
  ]);
  assert.deepEqual(out, { uploaded: 2, purged: true });
  assert.deepEqual(puts, ['vault/ebooks/PROD-1/chunks/page-1.svg.enc', 'vault/ebooks/PROD-1/chunks/page-2.svg.enc']);
  assert.deepEqual((upserted[0] as { where: unknown }).where, { ebookId_pageNumber: { ebookId: 'ebook-1', pageNumber: 1 } });
  assert.equal(await svc.verifyManifest('PROD-1', 2), true);
  assert.equal(await svc.verifyManifest('PROD-1', 3), false);
  const unknown = new EbookChunkerService(
    { ebookDetail: { findFirst: async () => null }, ebookChunkMeta: { upsert: async () => ({}), count: async () => 0 } } as unknown as PrismaService,
    fakeR2,
  );
  await assert.rejects(() => unknown.uploadChunks('GHOST', [{ pageNumber: 1, svgContent: 'x' }]), /Unknown ebook/);
  assert.equal(await unknown.verifyManifest('GHOST', 1), false);
  ok('Chunker plans/checksums, uploads + upserts idempotently, verifies parity');
}

// ---------- 4. Transcoder: ladder manifests + segment upload + parity ----------
{
  const master = buildMasterPlaylist('LESSON-9');
  assert.ok(master.includes('#EXTM3U'));
  for (const r of ['1080p', '720p', '480p', '360p']) {
    assert.ok(master.includes(`vault/hls/LESSON-9/${r}/index.m3u8`), `master missing ${r}`);
  }
  assert.ok(master.includes('BANDWIDTH=5200000'));
  const variant = buildVariantPlaylist(3, 6);
  assert.ok(variant.includes('#EXT-X-ENDLIST') && variant.includes('seg-2.ts'));
  assert.throws(() => buildVariantPlaylist(0, 6), /Invalid segment/);

  const puts: string[] = [];
  const upserted: unknown[] = [];
  const fakeR2 = { putObject: async (k: string) => { puts.push(k); return { eTag: 'e' }; } } as unknown as R2StorageService;
  const prisma = {
    courseLesson: { findFirst: async () => ({ id: 'LESSON-9' }) },
    hlsSegmentMeta: { upsert: async (a: unknown) => { upserted.push(a); return {}; }, count: async () => 8 },
  } as unknown as PrismaService;
  const svc = new HlsTranscoderService(prisma, fakeR2);
  const out = await svc.uploadSegments('LESSON-9', [
    { segmentIndex: 0, resolution: '720p', data: 'ts0', durationSec: 6 },
    { segmentIndex: 1, resolution: '720p', data: 'ts1', durationSec: 6 },
  ]);
  assert.equal(out.uploaded, 2);
  assert.ok(puts.includes('vault/hls/LESSON-9/720p/seg-0.ts'));
  assert.ok(puts.includes('vault/hls/LESSON-9/master.m3u8'));
  assert.ok(puts.includes('vault/hls/LESSON-9/720p/index.m3u8'));
  assert.deepEqual((upserted[0] as { where: unknown }).where, { lessonId_resolution_segmentIndex: { lessonId: 'LESSON-9', resolution: '720p', segmentIndex: 0 } });
  assert.equal(await svc.verifyLadder('LESSON-9', 2), true);
  assert.equal(await svc.verifyLadder('LESSON-9', 3), false);
  await assert.rejects(() => svc.uploadSegments('', [{ segmentIndex: 0, resolution: '720p', data: 'x', durationSec: 6 }]), /Missing lesson/);
  await assert.rejects(() => svc.uploadSegments('LESSON-9', []), /No produced segments/);
  await assert.rejects(() => svc.uploadSegments('LESSON-9', [{ segmentIndex: -1, resolution: '720p', data: 'x', durationSec: 6 }]), /Invalid segment/);
  ok('Transcoder ladder manifests + R2 upload + meta upsert + ladder parity');
}

// ---------- 5. Entitlement guard: preview/grant/403 matrix ----------
{
  const ctxOf = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;
  const grantPrisma = { entitlement: { findFirst: async () => ({ id: 'ent-1' }) } } as unknown as PrismaService;
  const emptyPrisma = { entitlement: { findFirst: async () => null } } as unknown as PrismaService;

  await assert.rejects(() => new EdgeStreamEntitlementGuard(grantPrisma).canActivate(ctxOf({ headers: {}, params: {} })), /Unauthorized/);
  const previewReq: Record<string, unknown> = { user: { id: 'u' }, params: { productId: 'p', pageNumber: '7' } };
  assert.equal(await new EdgeStreamEntitlementGuard(emptyPrisma).canActivate(ctxOf(previewReq)), true);
  assert.equal(previewReq.streamPreview, true);
  assert.equal(previewReq.streamUserId, 'u');

  const paidReq: Record<string, unknown> = { user: { id: 'u' }, params: { productId: 'p', pageNumber: '42' } };
  assert.equal(await new EdgeStreamEntitlementGuard(grantPrisma).canActivate(ctxOf(paidReq)), true);
  assert.equal(paidReq.streamPreview, false);
  await assert.rejects(() => new EdgeStreamEntitlementGuard(emptyPrisma).canActivate(ctxOf(paidReq)), /Content access denied/);
  // Lesson-only routes pass authenticated traffic through (controller joins + 403s).
  const lessonReq: Record<string, unknown> = { user: { id: 'u' }, params: { lessonId: 'l' } };
  assert.equal(await new EdgeStreamEntitlementGuard(emptyPrisma).canActivate(ctxOf(lessonReq)), true);
  assert.equal(lessonReq.streamPreview, false);
  ok('Guard anonymous→401, preview→pass, grant→pass, unowned→403, lesson→controller');
}

// ---------- 6. Fetcher: window eviction + transport errors (no React) ----------
{
  const realFetch = globalThis.fetch;
  const pages = new Map<number, { vectorSvgContent: string }>([
    [1, { vectorSvgContent: '<svg>1</svg>' }],
    [2, { vectorSvgContent: '<svg>2</svg>' }],
    [3, { vectorSvgContent: '<svg>3</svg>' }],
    [4, { vectorSvgContent: '<svg>4</svg>' }],
  ]);
  (globalThis as unknown as { fetch: unknown }).fetch = async (u: unknown) => {
    const page = Number(String(u).match(/page=(\d+)/)?.[1]);
    const hit = pages.get(page);
    if (!hit) return { ok: false, status: 404, json: async () => null };
    return { ok: true, json: async () => ({ pageNumber: page, vectorSvgContent: hit.vectorSvgContent, watermarkData: { watermarkText: 'W', timestamp: 't' } }) };
  };
  const fetcher = new R2CanvasChunkFetcher('PROD-1');
  assert.throws(() => new R2CanvasChunkFetcher(''), /Missing product/);
  await fetcher.fetchPageChunk(2);
  await fetcher.fetchPageChunk(3);
  await fetcher.fetchPageChunk(4);
  assert.deepEqual(fetcher.cachedPages, [2, 3, 4]);
  await fetcher.fetchPageChunk(5).catch(() => undefined);
  await fetcher.fetchPageChunk(1);
  // Jump 4→1 evicts the stale window: only [0,1,2] survive.
  assert.deepEqual(fetcher.cachedPages, [1, 2]);
  await assert.rejects(() => fetcher.fetchPageChunk(0), /Invalid page/);
  await assert.rejects(() => fetcher.fetchPageChunk(99), /Failed to load page 99/);
  await fetcher.prefetchWindow(2);
  assert.ok(fetcher.cachedPages.includes(2));
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  ok('Fetcher sliding window + 404/invalid mapping + prefetch warm');
}

// ---------- 7. HLS player + proxies + Prisma/module wiring + vault parity ----------
{
  const player = readFileSync('apps/frontend/components/stream/hls-r2-player.tsx', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'hls-manifest', 'canPlayType', 'โปรดเข้าสู่ระบบใหม่', 'bufferPct', 'ลองอีกครั้ง']) {
    assert.ok(player.includes(t), `player missing ${t}`);
  }
  assert.ok(!player.includes("from 'hls.js'") && !player.includes('from "hls.js"'), 'zero new deps: no hls.js import');
  for (const [f, marker] of [
    ['apps/frontend/app/api/v1/media-vault/chunk/route.ts', 'ebook-chunk'],
    ['apps/frontend/app/api/v1/media-vault/hls-manifest/route.ts', 'hls-manifest'],
    ['apps/frontend/app/api/v1/media-vault/upload-url/route.ts', 'upload-url'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model StorageVaultAsset', 'model EbookChunkMeta', 'model HlsSegmentMeta', 'chunkManifests', 'hlsSegments', 'r2HlsPrefix', '@@unique([ebookId, pageNumber])', '@@unique([lessonId, resolution, segmentIndex])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/infra/cloudflare/r2-storage.module.ts', 'utf8');
  assert.ok(mod.includes('R2StorageService') && mod.includes('MediaVaultController') && mod.includes('EdgeStreamEntitlementGuard'));
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('R2StorageModule'));
  const vault = readFileSync('apps/backend/src/api/controllers/media-vault.controller.ts', 'utf8');
  for (const t of ['api/v1/media-vault', 'ebook-chunk', 'hls-manifest', 'upload-url', 'JwtAuthGuard', 'EdgeStreamEntitlementGuard', 'X-Zero-Egress-Verified', 'X-Watermark-Signature', 'R2UploadRequestSchema']) {
    assert.ok(vault.includes(t), `vault missing ${t}`);
  }
  ok('Player 5-state + native HLS; 3 proxies; Prisma vault registry; module/vault parity');
}

console.log(`\nPhase 036 contracts: ${passed} checks passed`);
}

void main();
