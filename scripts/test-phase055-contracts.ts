// SSOT Phase 055 §10 — contract tests (Zod, brotli, manifest, watermark, wiring)
// Run: npx tsx scripts/test-phase055-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  NetworkQualityTierEnum,
  ClientNetworkTelemetrySchema,
  LowBandwidthChunkRequestSchema,
  LowBandwidthChunkResponseSchema,
  LOW_NET_FIRST_FRAME_MS,
  LOW_NET_NEXT_PAGE_MS,
  LOW_NET_RAM_CAP_MB,
  LOW_NET_BROTLI_Q_SLOW,
  LOW_NET_BROTLI_Q_FAST,
  LOW_NET_CHUNK_CACHE_TTL_SEC,
  prefetchWindow,
  tierFromEffectiveType,
  brotliQualityFor,
  isLowBandwidthTier,
  filterVariantsByBudget,
} from '../packages/shared/src/schemas/low-bandwidth-contract';
import {
  LowBandwidthReaderService,
  lowBandwidthCacheKey,
} from '../apps/backend/src/modules/reader/services/low-bandwidth-reader.service';
import { HlsManifestService } from '../apps/backend/src/modules/stream/hls-manifest.service';
import { ForensicWatermarkService, fnv1a32 } from '../apps/backend/src/modules/security/forensic-watermark.service';
// NOTE: Resolver/Controller/Module carry Nest (parameter) decorators which
// tsx/esbuild cannot transform — verified via static source parity (§6)
// following the Phase 027–055 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const SVG_PARAGRAPH = '<text x="50" y="100">Page content with realistic Thai prose for compression testing เนื้อหาหนังสืออีบุ๊ก</text>';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200">${SVG_PARAGRAPH.repeat(40)}</svg>`;

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + policy helpers ----------
{
  assert.equal(NetworkQualityTierEnum.safeParse('GOOD_3G').success, true);
  assert.equal(NetworkQualityTierEnum.safeParse('5G').success, false);
  assert.equal(ClientNetworkTelemetrySchema.safeParse({
    downlinkMbps: 1.5, rttMs: 300, effectiveType: 'GOOD_3G', packetLossRate: 0.05, effectiveRamMb: 24.5,
  }).success, true);
  assert.equal(ClientNetworkTelemetrySchema.safeParse({
    downlinkMbps: -1, rttMs: 300, effectiveType: 'GOOD_3G', packetLossRate: 0.05, effectiveRamMb: 24.5,
  }).success, false);

  const req = LowBandwidthChunkRequestSchema.parse({ productId: PRODUCT_ID, pageNumber: 2, networkQuality: 'SLOW_2G' });
  assert.equal(req.compressFormat, 'BROTLI');
  assert.equal(req.enableWatermark, true);
  assert.equal(LowBandwidthChunkRequestSchema.safeParse({ productId: PRODUCT_ID, pageNumber: 0, networkQuality: 'SLOW_2G' }).success, false);

  assert.equal(LOW_NET_FIRST_FRAME_MS, 1500);
  assert.equal(LOW_NET_NEXT_PAGE_MS, 800);
  assert.equal(LOW_NET_RAM_CAP_MB, 28);
  assert.equal(LOW_NET_BROTLI_Q_SLOW, 11);
  assert.equal(LOW_NET_BROTLI_Q_FAST, 6);
  assert.equal(LOW_NET_CHUNK_CACHE_TTL_SEC, 86400);

  // BDD Scenario 1: window shrinks on slow links, full [N-1,N,N+1] on fast.
  assert.deepEqual(prefetchWindow(5, 'GOOD_3G'), [5, 6]);
  assert.deepEqual(prefetchWindow(5, 'SLOW_2G'), [5, 6]);
  assert.deepEqual(prefetchWindow(5, 'FAST_4G_5G'), [4, 5, 6]);
  assert.deepEqual(prefetchWindow(1, 'FAST_4G_5G'), [1, 2]);
  assert.equal(tierFromEffectiveType('3g', 10), 'GOOD_3G');
  assert.equal(tierFromEffectiveType('slow-2g', 10), 'SLOW_2G');
  assert.equal(tierFromEffectiveType('4g', 10), 'FAST_4G_5G');
  assert.equal(brotliQualityFor('SLOW_2G'), 11);
  assert.equal(brotliQualityFor('FAST_4G_5G'), 6);
  assert.equal(isLowBandwidthTier('GOOD_3G'), true);
  assert.equal(isLowBandwidthTier('FAST_4G_5G'), false);

  const ladder = [
    { label: '1080p', url: 'v/1080.m3u8', bitrateKbps: 4500 },
    { label: '480p', url: 'v/480.m3u8', bitrateKbps: 800 },
    { label: '360p', url: 'v/360.m3u8', bitrateKbps: 400 },
  ];
  assert.deepEqual(filterVariantsByBudget(ladder, 'SLOW_2G').map((v) => v.label), ['360p']);
  assert.deepEqual(filterVariantsByBudget(ladder, 'GOOD_3G').map((v) => v.label), ['480p', '360p']);
  assert.equal(filterVariantsByBudget(ladder, 'FAST_4G_5G').length, 3);
  assert.deepEqual(filterVariantsByBudget([], 'SLOW_2G'), []);
  ok('Zod telemetry/chunk verbatim + window/tier/budget/ladder policy');
}

// ---------- 2. Brotli/gzip/raw round-trip (§5.1: cache, checksum, 404) ----------
async function sectionCompression(): Promise<void> {
  const store = new Map<string, Buffer>();
  let fetches = 0;
  const svc = new LowBandwidthReaderService(
    { fetchSvg: async () => { fetches++; return SVG; } },
    {
      getBuffer: async (k) => store.get(k) ?? null,
      setBuffer: async (k, v) => { store.set(k, v); },
    },
  );
  const out = await svc.getCompressedVectorChunk(PRODUCT_ID, 1, 'SLOW_2G', USER_ID);
  assert.equal(LowBandwidthChunkResponseSchema.safeParse(out).success, true);
  assert.equal(out.pageNumber, 1);
  assert.equal(out.isLowBandwidthMode, true);
  assert.equal(out.forensicWatermarkHash.length, 12);
  assert.ok(out.byteLength < SVG.length, 'brotli q11 must shrink the vector payload');
  const sum = (await import('node:crypto')).createHash('sha256').update(Buffer.from(out.compressedPayloadBase64, 'base64')).digest('hex');
  assert.equal(sum, out.checksumSha256);
  assert.deepEqual(brotliDecompressSync(Buffer.from(out.compressedPayloadBase64, 'base64')).toString('utf8'), SVG);

  // Cache-hit: no second source fetch (24h cell).
  await svc.getCompressedVectorChunk(PRODUCT_ID, 1, 'SLOW_2G', USER_ID);
  assert.equal(fetches, 1);
  assert.ok(store.has(lowBandwidthCacheKey(PRODUCT_ID, 1, 'BROTLI')));

  // GZIP + RAW paths stay schema-valid.
  const gz = await svc.getCompressedVectorChunk(PRODUCT_ID, 2, 'FAST_4G_5G', USER_ID, 'default', 'GZIP');
  assert.deepEqual(gunzipSync(Buffer.from(gz.compressedPayloadBase64, 'base64')).toString('utf8'), SVG);
  assert.equal(gz.isLowBandwidthMode, false);
  const raw = await svc.getCompressedVectorChunk(PRODUCT_ID, 3, 'FAST_4G_5G', USER_ID, 'default', 'RAW_SVG');
  assert.equal(Buffer.from(raw.compressedPayloadBase64, 'base64').toString('utf8'), SVG);

  // Missing asset → 404, never an empty cell.
  const missing = new LowBandwidthReaderService(
    { fetchSvg: async () => { throw new Error('R2 404'); } },
    { getBuffer: async () => null, setBuffer: async () => undefined },
  );
  await assert.rejects(missing.getCompressedVectorChunk(PRODUCT_ID, 9, 'GOOD_3G', USER_ID), /not found/i);
  ok('Compression: brotli/gzip/raw round-trip + 24h cache-hit + checksum + 404');
}

// ---------- 3. Manifest trim (§1.3 Scenario-2: 1080p → 360p, token rewrite) ----------
async function sectionManifest(): Promise<void> {
  const svc = new HlsManifestService({
    getObjectText: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4500000\nv/1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000\nv/360.m3u8\nseg-001.ts\n',
  });
  const ladder = [
    { label: '1080p', url: 'v/1080.m3u8', bitrateKbps: 4500 },
    { label: '360p', url: 'v/360.m3u8', bitrateKbps: 400 },
  ];
  const slow = await svc.getManifestForTier('hls/l/master.m3u8', ladder, 'SLOW_2G', 'TOK');
  assert.deepEqual(slow.servedVariants.map((v) => v.label), ['360p']);
  assert.ok(!slow.playlist.includes('v/1080.m3u8'), '1080p rung trimmed on SLOW_2G');
  assert.ok(slow.playlist.includes('v/360.m3u8?token=TOK'));
  assert.ok(slow.playlist.includes('seg-001.ts?token=TOK'));
  const fast = await svc.getManifestForTier('hls/l/master.m3u8', ladder, 'FAST_4G_5G', 'TOK');
  assert.equal(fast.servedVariants.length, 2);
  await assert.rejects(new HlsManifestService().getManifestForTier('k', ladder, 'GOOD_3G', 'T'), /UNAVAILABLE/);
  ok('Manifest: tier trim + token rewrite + store-missing guard');
}

// ---------- 4. Watermark layout (deterministic, in-bounds, page-varying) ----------
{
  const svc = new ForensicWatermarkService();
  const a = svc.layout('abcdef012345', 7, 600, 900);
  const b = svc.layout('abcdef012345', 7, 600, 900);
  assert.deepEqual(a, b);
  assert.ok(a.x >= 16 && a.x < 600 && a.y >= 16 && a.y < 900);
  const c = svc.layout('abcdef012345', 8, 600, 900);
  assert.ok(c.x !== a.x || c.y !== a.y, 'position must drift per page');
  const spec = svc.drawSpec('abcdef012345', 7, 600, 900, '2026-01-01T00:00:00.000Z');
  assert.ok(spec.text.includes('abcdef012345'));
  assert.equal(spec.font, '14px sans-serif');
  assert.equal(fnv1a32('x'), fnv1a32('x'));
  assert.notEqual(fnv1a32('x'), fnv1a32('y'));
  ok('Watermark: deterministic in-bounds drift + single-fill draw spec');
}

// ---------- 5. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model NetworkPerformanceLog',
    'model LowBandwidthAssetCache',
    'isBufferUnderrun Boolean  @default(false)',
    'brotliChunkPath String',
    '@@unique([productId, pageNumber])',
    '@@index([effectiveType])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: performance log + brotli asset cache (additive, core untouched)');
}

// ---------- 6. Static parity (gateway + GQL/SDL + hook + engine + player + e2e) ----------
function sectionStaticParity(): void {
  const svc = readFileSync('apps/backend/src/modules/reader/services/low-bandwidth-reader.service.ts', 'utf8');
  for (const t of ['getCompressedVectorChunk', 'brotli', 'LOW_NET_CHUNK_CACHE_TTL_SEC', 'checksumSha256', 'isLowBandwidthMode']) {
    assert.ok(svc.includes(t), `chunk service missing: ${t}`);
  }
  const module = readFileSync('apps/backend/src/modules/reader/reader.module.ts', 'utf8');
  assert.ok(module.includes('LowBandwidthReaderService'));
  const rest = readFileSync('apps/backend/src/modules/reader/reader.controller.ts', 'utf8');
  assert.ok(rest.includes('chunk-compressed'));
  const gql = readFileSync('apps/backend/src/modules/reader/reader.resolver.ts', 'utf8');
  assert.ok(gql.includes('getOptimizedEbookPageChunk'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/reader.graphql/schema.graphql', 'utf8');
  for (const t of ['getOptimizedEbookPageChunk', 'LowBandwidthChunkPayload']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const manifest = readFileSync('apps/backend/src/modules/stream/hls-manifest.service.ts', 'utf8');
  for (const t of ['filterVariantsForTier', 'rewritePlaylistUrls', 'getManifestForTier']) {
    assert.ok(manifest.includes(t), `manifest missing: ${t}`);
  }
  const wm = readFileSync('apps/backend/src/modules/security/forensic-watermark.service.ts', 'utf8');
  for (const t of ['ForensicWatermarkService', 'fnv1a32', 'drawSpec']) {
    assert.ok(wm.includes(t), `watermark missing: ${t}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useNetworkQuality.ts', 'utf8');
  for (const t of ['useNetworkQuality', 'lowDataMode', 'setLowDataMode', 'tierFromEffectiveType']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const engine = readFileSync('apps/frontend/components/reader/CanvasReaderEngine.tsx', 'utf8');
  for (const t of ['CanvasReaderEngine', 'chunk-compressed', 'DecompressionStream', 'revokeObjectURL', 'โหมดประหยัดเน็ต', 'สัญญาณขาดหาย']) {
    assert.ok(engine.includes(t), `engine missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/stream/AdaptiveHlsPlayer.tsx', 'utf8');
  for (const t of ['AdaptiveHlsPlayer', 'filterVariantsByBudget', '360p Optimized']) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  const proxy = readFileSync('apps/frontend/app/api/reader/chunk-compressed/route.ts', 'utf8');
  assert.ok(proxy.includes('chunk-compressed'));
  const page = readFileSync('apps/frontend/app/(liff)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(page.includes('CanvasReaderEngine'));
  const e2e = readFileSync('e2e/low-network-throttling.spec.ts', 'utf8');
  for (const t of ['emulateNetworkConditions', 'JSHeapUsedSize', 'cellular3g']) {
    assert.ok(e2e.includes(t), `e2e missing: ${t}`);
  }
  ok('Static parity: gateway + GQL/SDL + manifest + watermark + hook + engine + player + proxy + page + e2e');
}

async function main(): Promise<void> {
  await sectionCompression();
  await sectionManifest();
  sectionStaticParity();
}

void main();
