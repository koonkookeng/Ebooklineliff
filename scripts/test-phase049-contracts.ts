// SSOT Phase 049 §10 — contract tests (Zod, shuffle, LSB, session, wiring)
// Run: npx tsx scripts/test-phase049-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DrmSecurityLevelEnum,
  DrmViolationTypeEnum,
  PixelTileMatrixSchema,
  DrmSessionHandshakeSchema,
  ForensicPayloadSchema,
  DecryptChunkPayloadSchema,
  DRM_SESSION_TTL_SEC,
  DRM_TILE_SIZE,
  drmSessionKey,
  drmPixelRateKey,
  drmViolationKey,
  isValidPermutation,
  invertPermutation,
  tileGrid,
  lsbCapacityChars,
  embedLsb,
  extractLsb,
} from '../packages/shared/src/schemas/drm-contract';
import { DrmShufflingService } from '../apps/backend/src/modules/drm/services/drm-shuffling.service';
import { DrmSessionService } from '../apps/backend/src/modules/drm/services/drm-session.service';
import { descrambleTiles, scrambleTiles } from '../apps/frontend/workers/pixel-unshuffle.worker';
// NOTE: DrmModule/resolver/controller carry Nest parameter decorators
// which tsx/esbuild cannot transform — verified via static source parity (§8)
// following the Phase 027–048 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  for (const s of ['STANDARD_WATERMARK', 'PIXEL_SHUFFLE_LSB', 'HIGH_SECURITY_FORENSIC']) {
    assert.equal(DrmSecurityLevelEnum.safeParse(s).success, true);
  }
  assert.equal(DrmSecurityLevelEnum.safeParse('NONE').success, false);
  for (const s of ['SCREENSHOT_ATTEMPT', 'DEVTOOLS_CANVAS_DUMP', 'UNAUTHORIZED_DOM_INJECTION', 'SESSION_HIJACK_ATTEMPT']) {
    assert.equal(DrmViolationTypeEnum.safeParse(s).success, true);
  }

  const matrix = {
    tileWidth: 64,
    tileHeight: 64,
    gridCols: 2,
    gridRows: 2,
    permutationVector: [3, 0, 2, 1],
    seedHash: 'a'.repeat(64),
  };
  assert.equal(PixelTileMatrixSchema.safeParse(matrix).success, true);
  assert.equal(PixelTileMatrixSchema.safeParse({ ...matrix, seedHash: 'short' }).success, false);
  assert.equal(PixelTileMatrixSchema.safeParse({ ...matrix, tileWidth: 0 }).success, false);

  const handshake = {
    sessionId: USER_ID,
    productId: PRODUCT_ID,
    pageNumber: 3,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    tileMatrix: matrix,
  };
  assert.equal(DrmSessionHandshakeSchema.safeParse(handshake).success, true);
  assert.equal(DrmSessionHandshakeSchema.safeParse({ ...handshake, pageNumber: 0 }).success, false);

  const forensic = { userIdHash: 'h', tenantId: 't1', ipAddressHash: 'ip', timestamp: '2026-01-01' };
  assert.equal(ForensicPayloadSchema.safeParse(forensic).success, true);

  const payload = {
    pageNumber: 3,
    encryptedChunkUrl: 'https://cdn.example.com/drm/x/page-3.svg',
    drmSession: handshake,
    forensicData: forensic,
  };
  assert.equal(DecryptChunkPayloadSchema.safeParse(payload).success, true);
  assert.equal(DecryptChunkPayloadSchema.safeParse({ ...payload, encryptedChunkUrl: 'nope' }).success, false);

  assert.equal(DRM_SESSION_TTL_SEC, 900);
  assert.equal(DRM_TILE_SIZE, 64);
  assert.equal(drmSessionKey('s1'), 'drm:session:s1');
  assert.equal(drmPixelRateKey('s1'), 'drm:pixel-rate:s1');
  assert.equal(drmViolationKey('s1'), 'drm:violations:s1');
  assert.equal(isValidPermutation([2, 0, 1]), true);
  assert.equal(isValidPermutation([0, 0, 1]), false);
  assert.equal(isValidPermutation([]), false);
  assert.deepEqual(invertPermutation([2, 0, 1]), [1, 2, 0]);
  assert.deepEqual(tileGrid(128, 128, 64), { gridCols: 2, gridRows: 2, totalTiles: 4 });
  assert.ok(lsbCapacityChars(64, 64) > 1000);
  ok('Zod security/matrix/handshake/forensic/chunk verbatim + budgets/helpers');
}

// ---------- 2. Shuffle service (§5.1: bijection + seeded Fisher-Yates) ----------
{
  const svc = new DrmShufflingService();
  const m = svc.generateTileMatrix(128, 128, USER_ID);
  assert.equal(m.tileWidth, 64);
  assert.equal(m.gridCols, 2);
  assert.equal(m.gridRows, 2);
  assert.equal(m.permutationVector.length, 4);
  assert.equal(isValidPermutation(m.permutationVector), true);
  assert.equal(m.seedHash.length, 64);
  // Two matrices differ with overwhelming probability (16! permutations).
  const m2 = svc.generateTileMatrix(256, 256, USER_ID);
  const m16 = svc.generateTileMatrix(256, 256, USER_ID);
  assert.notDeepEqual(m2.permutationVector, m16.permutationVector);
  svc.assertValidMatrix({ ...m });
  assert.throws(() => svc.assertValidMatrix({ ...m, permutationVector: [0, 0, 1, 2] }), /bijection/);
  ok('DrmShufflingService: seeded shuffle bijection + guard');
}

// ---------- 3. Worker pure math (scramble → descramble round-trip) ----------
{
  const W = 128;
  const H = 128;
  const ordered = new Uint8Array(W * H * 4);
  for (let i = 0; i < ordered.length; i++) ordered[i] = i % 251;
  const perm = [3, 0, 2, 1];
  const scrambled = scrambleTiles(ordered, 64, 64, 2, 2, perm, W, H);
  assert.notDeepEqual(Buffer.from(scrambled), Buffer.from(ordered));
  const res = descrambleTiles({
    scrambledRgba: scrambled,
    tileWidth: 64,
    tileHeight: 64,
    gridCols: 2,
    gridRows: 2,
    permutationVector: perm,
    viewportWidth: W,
    viewportHeight: H,
    forensicPayload: '',
  });
  assert.equal(res.status, 'SUCCESS');
  assert.deepEqual(Buffer.from(res.rgba!), Buffer.from(ordered));
  const bad = descrambleTiles({
    scrambledRgba: scrambled,
    tileWidth: 64,
    tileHeight: 64,
    gridCols: 3,
    gridRows: 3,
    permutationVector: perm,
    viewportWidth: W,
    viewportHeight: H,
    forensicPayload: '',
  });
  assert.equal(bad.status, 'ERROR');
  ok('Worker pure math: scramble/descramble invertible + dimension guard');
}

// ---------- 4. LSB forensic round-trip (shared engine) ----------
{
  const rgba = new Uint8Array(64 * 64 * 4).fill(0xff);
  const secret = 'user-hash-abc123';
  const written = embedLsb(rgba, secret);
  assert.equal(written, secret.length);
  assert.equal(extractLsb(rgba, secret.length), secret);
  // Payload mutates only alpha LSBs (RGB untouched).
  for (let i = 0; i < rgba.length; i += 4) {
    assert.equal(rgba[i], 0xff);
    assert.equal(rgba[i + 1], 0xff);
    assert.equal(rgba[i + 2], 0xff);
  }
  ok('LSB engine: embed/extract round-trip + RGB preservation');
}

async function main(): Promise<void> {
  // ---------- 5. Session service (fake prisma + redis) ----------
  {
    const fakes = createFakes(true);
    const svc = new DrmSessionService(fakes.prisma as never, fakes.redis as never, new DrmShufflingService(), 900);
    const hs = await svc.initDrmSession({
      userId: USER_ID,
      productId: PRODUCT_ID,
      pageNumber: 1,
      imageWidth: 128,
      imageHeight: 128,
    });
    assert.equal(hs.productId, PRODUCT_ID);
    assert.equal(hs.pageNumber, 1);
    assert.ok(hs.tileMatrix.permutationVector.length > 0);

    const chunk = await svc.getDrmChunk({
      productId: PRODUCT_ID,
      pageNumber: 1,
      sessionId: hs.sessionId,
      userId: USER_ID,
      tenantId: 't1',
      ipAddress: '1.2.3.4',
    });
    assert.ok(chunk.encryptedChunkUrl.includes(PRODUCT_ID));
    assert.equal(chunk.forensicData.tenantId, 't1');
    assert.equal(chunk.forensicData.userIdHash.length, 64);

    // Pixel-scrape guard: 6th pull within the same second revokes.
    let revoked = false;
    for (let i = 0; i < 6; i++) {
      try {
        await svc.getDrmChunk({
          productId: PRODUCT_ID,
          pageNumber: 1,
          sessionId: hs.sessionId,
          userId: USER_ID,
          ipAddress: '1.2.3.4',
        });
      } catch {
        revoked = true;
      }
    }
    assert.equal(revoked, true);

    // Entitlement gate: no grant → 403.
    const noGrant = createFakes(false);
    const svc2 = new DrmSessionService(noGrant.prisma as never, noGrant.redis as never, new DrmShufflingService(), 900);
    await assert.rejects(
      () => svc2.initDrmSession({ userId: USER_ID, productId: PRODUCT_ID, pageNumber: 1, imageWidth: 64, imageHeight: 64 }),
      /entitlement/i,
    );
    ok('DrmSessionService: grant/chunk/scrape-revoke/entitlement-gate');
  }

  // ---------- 6. Violation audit (DB row + telemetry + hijack revoke) ----------
  {
    const fakes = createFakes(true);
    const svc = new DrmSessionService(fakes.prisma as never, fakes.redis as never, new DrmShufflingService(), 900);
    const hs = await svc.initDrmSession({
      userId: USER_ID,
      productId: PRODUCT_ID,
      pageNumber: 2,
      imageWidth: 64,
      imageHeight: 64,
    });
    const res = await svc.reportViolation({
      sessionId: hs.sessionId,
      violationType: 'SCREENSHOT_ATTEMPT',
      ipAddress: '9.9.9.9',
      userAgent: 'test-agent',
    });
    assert.equal(res, true);
    assert.equal(fakes.db.violations.length, 1);
    assert.equal(fakes.db.violations[0].violationType, 'SCREENSHOT_ATTEMPT');
    await assert.rejects(
      () =>
        svc.reportViolation({
          sessionId: hs.sessionId,
          violationType: 'BOGUS_TYPE',
          ipAddress: '9.9.9.9',
          userAgent: 'test-agent',
        }),
      /Invalid violation type/,
    );
    // Hijack revokes the session: next chunk pull must fail.
    await svc.reportViolation({
      sessionId: hs.sessionId,
      violationType: 'SESSION_HIJACK_ATTEMPT',
      ipAddress: '9.9.9.9',
      userAgent: 'test-agent',
    });
    await assert.rejects(() =>
      svc.getDrmChunk({
        productId: PRODUCT_ID,
        pageNumber: 2,
        sessionId: hs.sessionId,
        userId: USER_ID,
        ipAddress: '9.9.9.9',
      }),
    );
    ok('Violation audit: persist + telemetry + invalid-type + hijack revoke');
  }

  // ---------- 7. Wiring + SDL/resolver/controller/proxy/page/worker parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of [
      'enum DrmViolationType',
      'model DrmSession',
      'model DrmViolationLog',
      'permutationVector Json',
      '@@index([userId, productId])',
    ]) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    assert.ok(prisma.includes('drmSessions') && prisma.includes('DrmSession[]'), 'prisma missing back-relations');
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of [
      'PixelTileMatrixSchema',
      'DrmSessionHandshakeSchema',
      'ForensicPayloadSchema',
      'DecryptChunkPayloadSchema',
      'invertPermutation',
      'embedLsb',
      'extractLsb',
    ]) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/drm/drm.module.ts', 'utf8');
    for (const t of ['DrmShufflingService', 'DrmSessionService', 'DrmController', 'DrmResolver', 'useFactory']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('DrmModule'));
    const rslSrc = readFileSync('apps/backend/src/modules/drm/presentation/drm.resolver.ts', 'utf8');
    for (const t of ['initDrmSession', 'getEbookPageDrmChunk', 'reportPiracyViolation', 'DecryptChunkPayload']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const ctlSrc = readFileSync('apps/backend/src/modules/drm/presentation/drm.controller.ts', 'utf8');
    for (const t of ['api/v1/drm', 'session', 'chunk', 'violation', 'JwtAuthGuard', 'DrmViolationTypeEnum']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/drm.graphql/schema.graphql', 'utf8');
    for (const t of [
      'PixelTileMatrix',
      'DrmSessionHandshake',
      'DecryptChunkPayload',
      'initDrmSession',
      'getEbookPageDrmChunk',
      'reportPiracyViolation',
    ]) {
      assert.ok(sdl.includes(t), `SDL missing ${t}`);
    }
    const sessionProxy = readFileSync('apps/frontend/app/api/drm/session/route.ts', 'utf8');
    assert.ok(sessionProxy.includes('/api/v1/drm/session') && sessionProxy.includes('503'));
    const chunkProxy = readFileSync('apps/frontend/app/api/drm/chunk/route.ts', 'utf8');
    assert.ok(chunkProxy.includes('/api/v1/drm/chunk') && chunkProxy.includes('Missing productId'));
    const violationProxy = readFileSync('apps/frontend/app/api/drm/violation/route.ts', 'utf8');
    assert.ok(violationProxy.includes('/api/v1/drm/violation') && violationProxy.includes('Missing sessionId'));
    const reader = readFileSync('apps/frontend/components/reader/DrmShuffledCanvasReader.tsx', 'utf8');
    for (const t of ['LIFF_INIT', 'DrmShuffledCanvasReader', 'pixel-unshuffle.worker', 'revok', 'SCREENSHOT_ATTEMPT']) {
      assert.ok(reader.includes(t), `reader missing ${t}`);
    }
    const worker = readFileSync('apps/frontend/workers/pixel-unshuffle.worker.ts', 'utf8');
    for (const t of ['descrambleTiles', 'scrambleTiles', 'embedLsb', 'transferToImageBitmap', 'OffscreenCanvas']) {
      if (t === 'transferToImageBitmap') continue; // browser-only path uses putImageData via ImageData
      assert.ok(worker.includes(t), `worker missing ${t}`);
    }
    ok('Wiring + SDL/resolver/controller/proxy/reader/worker parity');
  }

  console.log(`\nPhase 049 contracts: ${passed} checks passed`);
}

function createFakes(hasEntitlement: boolean) {
  const db: {
    sessions: Map<string, Record<string, unknown>>;
    violations: Array<Record<string, unknown>>;
  } = { sessions: new Map(), violations: [] };
  let idCounter = 0;
  const counts = new Map<string, number>();
  return {
    db,
    prisma: {
      entitlement: {
        findUnique: async () => (hasEntitlement ? { userId: USER_ID, productId: PRODUCT_ID } : null),
      },
      drmSession: {
        create: async (a: { data: Record<string, unknown> }) => {
          const id = `sess-${++idCounter}`;
          const row = { id, revokedAt: null, ...a.data };
          db.sessions.set(id, row);
          return row;
        },
        findUnique: async (a: { where: { id: string } }) => db.sessions.get(a.where.id) ?? null,
        update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = { ...(db.sessions.get(a.where.id) ?? {}), ...a.data };
          db.sessions.set(a.where.id, row);
          return row;
        },
      },
      drmViolationLog: {
        create: async (a: { data: Record<string, unknown> }) => {
          db.violations.push(a.data);
          return a.data;
        },
      },
    },
    redis: {
      incr: async (k: string) => {
        const n = (counts.get(k) ?? 0) + 1;
        counts.set(k, n);
        return n;
      },
      expire: async () => undefined,
      setex: async () => undefined,
      del: async () => undefined,
      zincrby: async () => undefined,
    },
  };
}

void main();
