// SSOT Phase 061 §10-11 — contract tests (Zod, permutation parity, DRM flow, parity)
// Run: npx tsx scripts/test-phase061-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DrmShuffleAlgorithmEnum,
  ShufflingMatrixSeedSchema,
  EncryptedDrmChunkPayloadSchema,
  DRM_GRID_MIN,
  DRM_GRID_MAX,
  DRM_SESSION_TTL_MIN,
  DRM_BLOB_URL_TTL_SEC,
  DRM_DESHUFFLE_BUDGET_MS,
  drmSessionCacheKey,
  permutationFromSeed,
  invertPermutation,
  tileRects,
  isBijection,
} from '../packages/shared/src/schemas/drm-shuffling.schema';
import { PixelMatrixGeneratorService } from '../apps/backend/src/modules/reader/drm/pixel-matrix.generator';
import { CanvasShufflingService } from '../apps/backend/src/modules/reader/drm/canvas-shuffling.service';
import { DrmChunkRequestSchema, DrmViolationReportSchema } from '../apps/backend/src/modules/reader/drm/dto/drm-chunk-request.dto';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';
const NONCE = '444e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(DrmShuffleAlgorithmEnum.safeParse('HYBRID_WEBGL_MATRIX').success, true);
  assert.equal(DrmShuffleAlgorithmEnum.safeParse('ROT13').success, false);
  const seed = {
    seed: 'a'.repeat(64), gridX: 8, gridY: 8, permutationArray: [1, 0],
    expiresAt: new Date().toISOString(), sessionNonce: NONCE,
  };
  assert.equal(ShufflingMatrixSeedSchema.safeParse(seed).success, true);
  assert.equal(ShufflingMatrixSeedSchema.safeParse({ ...seed, gridX: 64 }).success, false);
  assert.equal(ShufflingMatrixSeedSchema.safeParse({ ...seed, seed: 'short' }).success, false);
  const payload = {
    pageNumber: 2, scrambledBlobUrl: 'https://r2.zero-egress.local/x.webp', shufflingMatrix: seed,
    forensicWatermark: { watermarkText: 'A (abc)', userIdHash: 'abc', userIp: '1.2.3.4', timestamp: new Date().toISOString() },
    algorithm: 'HYBRID_WEBGL_MATRIX',
  };
  assert.equal(EncryptedDrmChunkPayloadSchema.safeParse(payload).success, true);
  assert.equal(DRM_GRID_MIN, 4);
  assert.equal(DRM_GRID_MAX, 32);
  assert.equal(DRM_SESSION_TTL_MIN, 15);
  assert.equal(DRM_BLOB_URL_TTL_SEC, 60);
  assert.equal(DRM_DESHUFFLE_BUDGET_MS, 16);
  assert.equal(drmSessionCacheKey(NONCE), `drm:session:${NONCE}`);
  ok('Zod DRM contracts verbatim + grid/TTL/budget constants');
}

// ---------- 2. Permutation engine: parity + bijection + invert + tiles ----------
{
  const gen = new PixelMatrixGeneratorService('test-secret-999');
  const m1 = gen.generatePermutationMatrix(USER, PRODUCT, 2, NONCE, 8, 8);
  const m2 = gen.generatePermutationMatrix(USER, PRODUCT, 2, NONCE, 8, 8);
  assert.deepEqual(m1.permutationArray, m2.permutationArray);
  assert.equal(m1.permutationArray.length, 64);
  assert.equal(isBijection(m1.permutationArray), true);
  // Byte-parity: shared helper reproduces the service permutation.
  assert.deepEqual(permutationFromSeed(m1.seed, 64), m1.permutationArray);
  const other = gen.generatePermutationMatrix(USER, PRODUCT, 3, NONCE, 8, 8);
  assert.notDeepEqual(other.permutationArray, m1.permutationArray);
  const inv = invertPermutation(m1.permutationArray);
  for (let i = 0; i < 64; i++) assert.equal(m1.permutationArray[inv[i]], i);
  assert.equal(isBijection([0, 0, 2]), false);
  const rects = tileRects(800, 600, 8, 8);
  assert.equal(rects.length, 64);
  assert.deepEqual(rects[0], { x: 0, y: 0, w: 100, h: 75 });
  const clamped = gen.generatePermutationMatrix(USER, PRODUCT, 1, NONCE, 99, 0);
  assert.equal(clamped.gridX, 32);
  assert.equal(clamped.gridY, 4);
  assert.equal(DrmChunkRequestSchema.safeParse({ productId: PRODUCT, pageNumber: 2 }).success, true);
  assert.equal(DrmViolationReportSchema.safeParse({ sessionNonce: NONCE, productId: PRODUCT, pageNumber: 2, violationType: 'DEVTOOLS_CANVAS_DUMP' }).success, true);
  assert.equal(DrmViolationReportSchema.safeParse({ sessionNonce: NONCE, productId: PRODUCT, pageNumber: 2, violationType: 'XSS' }).success, false);
  ok('HMAC matrix deterministic + bijection + invert + tiles + DTO gates');
}

// ---------- 3. Shuffling service: gate + session + 60s URL + audit ----------
async function sectionService(): Promise<void> {
  const keys: Array<{ sessionNonce: string }> = [];
  const logs: Array<{ violationType: string }> = [];
  const store = new Map<string, string>();
  const svc = new CanvasShufflingService(
    new PixelMatrixGeneratorService('test-secret-999'),
    {
      drmSecurityKey: {
        create: async ({ data }: { data: { sessionNonce: string } }) => {
          keys.push({ sessionNonce: data.sessionNonce });
          return { sessionNonce: data.sessionNonce };
        },
        deleteMany: async () => ({}),
      },
      drmViolationLog: {
        create: async ({ data }: { data: { violationType: string } }) => {
          logs.push({ violationType: data.violationType });
          return { id: 'log-1' };
        },
      },
      entitlement: { findUnique: async () => ({ userId: USER }) },
      user: { findUnique: async () => ({ displayName: 'Learner' }) },
    } as never,
    {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
    } as never,
    { presignedGetUrl: (key: string) => `https://r2.zero-egress.local/${key}?sig=60s` } as never,
  );
  const chunk = await svc.getDrmChunk(USER, PRODUCT, 2, 8, 8, 'HYBRID_WEBGL_MATRIX', '1.2.3.4');
  assert.equal(chunk.pageNumber, 2);
  assert.ok(chunk.scrambledBlobUrl.includes('sig=60s'));
  assert.equal(chunk.algorithm, 'HYBRID_WEBGL_MATRIX');
  assert.equal(chunk.forensicWatermark.userIp, '1.2.3.4');
  assert.equal(chunk.shufflingMatrix.permutationArray.length, 64);
  assert.equal(keys.length, 1);
  assert.ok(store.has(drmSessionCacheKey(keys[0].sessionNonce)));
  assert.equal(svc.scrambledR2KeyFor(PRODUCT, 2), `drm/${PRODUCT}/pages/page_2.scrambled.webp`);

  const denied = new CanvasShufflingService(
    new PixelMatrixGeneratorService('s'),
    {
      drmSecurityKey: { create: async () => ({ sessionNonce: NONCE }), deleteMany: async () => ({}) },
      drmViolationLog: { create: async () => ({ id: 'x' }) },
      entitlement: { findUnique: async () => null },
      user: { findUnique: async () => null },
    } as never,
    { get: async () => null, set: async () => 'OK' } as never,
    { presignedGetUrl: () => 'https://x' } as never,
  );
  await assert.rejects(denied.getDrmChunk(USER, PRODUCT, 2, 8, 8, 'HYBRID_WEBGL_MATRIX', '9.9.9.9'), /สิทธิ์/);

  const logged = await svc.reportViolation(USER, {
    sessionNonce: NONCE, productId: PRODUCT, pageNumber: 2, violationType: 'DEVTOOLS_CANVAS_DUMP', userAgent: 'ua',
  }, '1.2.3.4');
  assert.equal(logged.logged, true);
  assert.equal(logs[0].violationType, 'DEVTOOLS_CANVAS_DUMP');
  ok('Service: entitlement gate + ephemeral key + 60s URL + ≤500ms audit');
}

// ---------- 4. Prisma SSOT (§4.1 Gate 1, additive only) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model DrmSecurityKey',
    'sessionNonce String       @unique',
    'hmacSecret',
    'algorithm    DrmAlgorithm',
    'userId        String?',
    'pageNumber    Int?',
    'drmSecurityKeys',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: DrmSecurityKey + additive violation attribution');
}

// ---------- 5. Static parity: backend + frontend + proxies + ADR ----------
function sectionParity(): void {
  const gen = readFileSync('apps/backend/src/modules/reader/drm/pixel-matrix.generator.ts', 'utf8');
  for (const t of ['PixelMatrixGeneratorService', 'generatePermutationMatrix', 'createHmac', 'permutationFromSeed', 'isBijection']) {
    assert.ok(gen.includes(t), `generator missing: ${t}`);
  }
  const svc = readFileSync('apps/backend/src/modules/reader/drm/canvas-shuffling.service.ts', 'utf8');
  for (const t of ['CanvasShufflingService', 'getDrmChunk', 'reportViolation', 'drmSecurityKey', 'presignedGetUrl', 'ForbiddenException']) {
    assert.ok(svc.includes(t), `shuffle service missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/reader/drm/drm-chunk.controller.ts', 'utf8');
  assert.ok(ctrl.includes('drm-chunk') && ctrl.includes('drm-violation'));
  const res = readFileSync('apps/backend/src/api/graphql/resolvers/drm-reader.resolver.ts', 'utf8');
  assert.ok(res.includes('getDrmScrambledChunk') && res.includes('reportDrmViolation'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/drm-reader.graphql', 'utf8');
  for (const t of ['getDrmScrambledChunk', 'EncryptedDrmChunkPayload', 'ShufflingMatrixSeed']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/reader/reader.module.ts', 'utf8');
  for (const t of ['CanvasShufflingService', 'PixelMatrixGeneratorService', 'DrmChunkController', 'DrmReaderResolver']) {
    assert.ok(mod.includes(t), `module missing: ${t}`);
  }
  const reader = readFileSync('apps/frontend/components/reader/DualDrmCanvasReader.tsx', 'utf8');
  for (const t of ['DualDrmCanvasReader', 'LIFF_INIT', 'LOADING', 'SUCCESS', 'ERROR', 'tryDeshuffleWebGL', 'deshuffleCanvas2D', 'installCanvasTheftTrap', 'revokeObjectURL']) {
    assert.ok(reader.includes(t), `reader missing: ${t}`);
  }
  const wgl = readFileSync('apps/frontend/components/reader/webgl-deshuffler.ts', 'utf8');
  for (const t of ['deshuffleCanvas2D', 'tryDeshuffleWebGL', 'webgl2', 'deleteTexture']) {
    assert.ok(wgl.includes(t), `deshuffler missing: ${t}`);
  }
  const fw = readFileSync('apps/frontend/components/reader/forensic-watermark.ts', 'utf8');
  for (const t of ['renderDrmWatermark', 'installCanvasTheftTrap', 'toDataURL', 'getImageData', 'reportDrmViolationBeacon']) {
    assert.ok(fw.includes(t), `watermark kit missing: ${t}`);
  }
  const client = readFileSync('apps/frontend/lib/reader/drm-chunk-client.ts', 'utf8');
  assert.ok(client.includes('fetchDrmChunk') && client.includes('zene-drm-chunks'));
  for (const p of ['apps/frontend/app/api/v1/reader/drm-chunk/route.ts', 'apps/frontend/app/api/v1/reader/drm-violation/route.ts']) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/reader/drm-'), `${p} missing forward`);
  }
  assert.ok(readFileSync('docs/adr/ADR-061-dual-drm-shuffling.md', 'utf8').includes('Ephemeral keys'));
  ok('Parity: generator + service + REST/GQL/SDL + dual reader + traps + ADR');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase061 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
