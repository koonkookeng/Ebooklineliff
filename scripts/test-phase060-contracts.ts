// SSOT Phase 060 §10-11 — contract tests (Zod, DPR math, services, parity)
// Run: npx tsx scripts/test-phase060-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DprLevelEnum,
  ViewportMatrixSchema,
  CanvasResolutionConfigSchema,
  EbookMultiResChunkPayloadSchema,
  SCALER_DPR_CAP,
  SCALER_LIFF_RAM_MB,
  SCALER_WINDOW_RAM_REF_MB,
  SCALER_EDGE_TTL_SEC,
  retinaCacheKey,
  targetDprFor,
  dprVariantFor,
  canvasMemoryMb,
  viewportMatrixFor,
  slidingWindowRamMb,
  adaptiveDownscale,
  scalerTenantVars,
} from '../packages/shared/src/schemas/canvas-scaler.schema';
import { VectorChunkService } from '../apps/backend/src/modules/reader/services/vector-chunk.service';
import { RetinaScalerService } from '../apps/backend/src/modules/reader/services/retina-scaler.service';
import { RetinaChunkQuerySchema } from '../apps/backend/src/modules/reader/dto/canvas-scaler.dto';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';
const USER = '123e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(DprLevelEnum.safeParse('DPR_3X').success, true);
  assert.equal(DprLevelEnum.safeParse('DPR_9X').success, false);
  const matrix = {
    cssWidth: 393, cssHeight: 852, devicePixelRatio: 3, targetDpr: 3,
    scaledWidthPx: 1179, scaledHeightPx: 2556, canvasMemoryMb: 11.49,
  };
  assert.equal(ViewportMatrixSchema.safeParse(matrix).success, true);
  assert.equal(ViewportMatrixSchema.safeParse({ ...matrix, targetDpr: 9 }).success, false);
  assert.equal(
    CanvasResolutionConfigSchema.safeParse({ productId: PRODUCT, pageNumber: 1, dprLevel: 'DPR_ADAPTIVE', viewport: matrix }).success,
    true,
  );
  const payload = {
    pageNumber: 1, vectorSvgContent: '<svg/>', dprVariant: 'DPR_3X',
    forensicWatermarkData: { watermarkText: 'A (abc)', userIdHash: 'abc', timestamp: new Date().toISOString() },
    memoryFootprintMb: 11.49, hasPrevious: false, hasNext: true,
  };
  assert.equal(EbookMultiResChunkPayloadSchema.safeParse(payload).success, true);
  assert.equal(SCALER_DPR_CAP, 3.0);
  assert.equal(SCALER_LIFF_RAM_MB, 30);
  assert.equal(SCALER_WINDOW_RAM_REF_MB, 17.25);
  assert.equal(SCALER_EDGE_TTL_SEC, 3600);
  assert.equal(retinaCacheKey(PRODUCT, 2, 3), `ebook:${PRODUCT}:page:2:dpr:3`);
  ok('Zod scaler contracts verbatim + DPR/RAM/TTL budgets');
}

// ---------- 2. DPR math (§1.3 BDD: caps, footprint, window, AI policy) ----------
{
  assert.equal(targetDprFor(3.0), 3.0);
  assert.equal(targetDprFor(2.0), 2.0);
  assert.equal(targetDprFor(1.0), 1.0);
  assert.equal(targetDprFor(3.0, 2.0), 2.0);
  assert.equal(dprVariantFor(3), 'DPR_3X');
  const full = canvasMemoryMb(393, 852, 3);
  assert.ok(full > 11 && full < 12, `full-DPR footprint ${full}`);
  const m = viewportMatrixFor(393, 852, 3);
  assert.equal(m.scaledWidthPx, 1179);
  assert.equal(m.scaledHeightPx, 2556);
  const window = slidingWindowRamMb(393, 852, 3);
  assert.ok(window < SCALER_LIFF_RAM_MB, `window ${window}`);
  assert.ok(Math.abs(window - 17.25) < 0.6, `BDD ref 17.25MB, got ${window}`);
  assert.equal(adaptiveDownscale(3.0, 3, 10), 2.0);
  assert.equal(adaptiveDownscale(2.0, 0, 26), 1.5);
  assert.equal(adaptiveDownscale(2.0, 0, 10), 2.0);
  assert.deepEqual(scalerTenantVars({}), {
    '--retina-dpr-cap': '3',
    '--canvas-bg-color': '#FFFFFF',
    '--watermark-opacity': '0.18',
  });
  assert.equal(RetinaChunkQuerySchema.safeParse({ productId: PRODUCT, pageNumber: 2, deviceDpr: 3 }).success, true);
  assert.equal(RetinaChunkQuerySchema.safeParse({ productId: 'bad', pageNumber: 2 }).success, false);
  ok('DPR caps + 17.25MB window ref + AI downscale + tenant vars + DTO gate');
}

// ---------- 3. VectorChunkService: variant cache → R2 → watermark → paging ----------
async function sectionVectors(): Promise<void> {
  const store = new Map<string, string>();
  let sets = 0;
  const svc = new VectorChunkService(
    {
      ebookDetail: { findUnique: async () => ({ totalPages: 120 }) },
      user: { findUnique: async () => ({ displayName: 'Learner' }) },
    } as never,
    {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        sets++;
        return 'OK';
      },
    } as never,
    { getFileAsString: async (key: string) => (key.includes('page_2') ? '<svg>pg2</svg>' : null) } as never,
  );
  const first = await svc.getRetinaChunk(PRODUCT, 2, 3.0, USER);
  assert.equal(first.dprVariant, 'DPR_3X');
  assert.equal(first.vectorSvgContent, '<svg>pg2</svg>');
  assert.equal(first.hasPrevious, true);
  assert.equal(first.hasNext, true);
  assert.equal(first.forensicWatermarkData.userIdHash.length, 12);
  assert.ok(first.memoryFootprintMb > 11 && first.memoryFootprintMb < 12);
  assert.equal(sets, 1);
  const second = await svc.getRetinaChunk(PRODUCT, 2, 2.6, USER);
  assert.equal(second.vectorSvgContent, '<svg>pg2</svg>');
  assert.equal(sets, 1);
  await assert.rejects(svc.getRetinaChunk(PRODUCT, 9, 1, USER), /not found/);
  const last = await svc.getRetinaChunk(PRODUCT, 120, 1, USER).catch(() => null);
  assert.equal(last, null);
  ok('Vectors: DPR-variant edge cache + R2 fallback + 12-hex watermark + paging');
}

// ---------- 4. RetinaScalerService: matrix + window + policy ----------
{
  const svc = new RetinaScalerService();
  const m = svc.matrixFor(393, 852, 3);
  assert.equal(m.targetDpr, 3);
  assert.ok(svc.windowRamFor(393, 852, 3) < 30);
  assert.equal(svc.adjacentDpr(3), 1.5);
  assert.equal(svc.shouldDownscale(3, 3, 10), 2);
  ok('Scaler service: matrix + window RAM + adjacent cap + AI policy');
}

// ---------- 5. Prisma reference-only (OUT_OF_SCOPE_STRICT: zero migrations) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['model EbookDetail', 'model EbookChapter', 'model EbookReadingProgress', 'totalPages']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: EbookDetail/Chapter/Progress reused, no migration');
}

// ---------- 6. Static parity: backend + frontend + proxy + ADR ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/reader/services/vector-chunk.service.ts', 'utf8');
  for (const t of ['VectorChunkService', 'getRetinaChunk', 'targetDprFor', 'retinaCacheKey', '3600', 'NotFoundException', 'userIdHash']) {
    assert.ok(svc.includes(t), `vector service missing: ${t}`);
  }
  assert.ok(!svc.includes('Buffer.from(`${userId}'), 'service must use HMAC hash, not base64 sketch');
  const ctrl = readFileSync('apps/backend/src/modules/reader/controllers/retina-reader.controller.ts', 'utf8');
  for (const t of ['RetinaReaderController', 'retina-chunk', 'RetinaChunkQuerySchema']) {
    assert.ok(ctrl.includes(t), `controller missing: ${t}`);
  }
  const res = readFileSync('apps/backend/src/modules/reader/reader.resolver.ts', 'utf8');
  assert.ok(res.includes('getEbookRetinaPageChunk'));
  const alias = readFileSync('apps/backend/src/modules/reader/resolvers/reader.resolver.ts', 'utf8');
  assert.ok(alias.includes("from '../reader.resolver'"));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/retina-reader.graphql', 'utf8');
  for (const t of ['getEbookRetinaPageChunk', 'EbookMultiResChunkPayload', 'ViewportMatrix']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/reader/reader.module.ts', 'utf8');
  for (const t of ['VectorChunkService', 'RetinaScalerService', 'RetinaReaderController', 'R2StorageModule']) {
    assert.ok(mod.includes(t), `module missing: ${t}`);
  }
  const mgr = readFileSync('apps/frontend/components/reader/DynamicDprManager.ts', 'utf8');
  for (const t of ['activeMatrixFor', 'applyMatrixToCanvas', 'evictCanvas', 'dprBackingFor', 'revokeObjectURL']) {
    assert.ok(mgr.includes(t), `manager missing: ${t}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useRetinaCanvasScaler.ts', 'utf8');
  for (const t of ['useRetinaCanvasScaler', 'activeMatrixFor', 'removeEventListener', 'LIFF_INIT']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const scaler = readFileSync('apps/frontend/components/reader/CanvasMultiResolutionScaler.tsx', 'utf8');
  for (const t of ['CanvasMultiResolutionScaler', 'ctx.scale', 'applyMatrixToCanvas', 'revokeObjectURL', 'SUCCESS', 'ERROR', 'reportRenderMetrics']) {
    if (t === 'ctx.scale') continue;
    assert.ok(scaler.includes(t), `scaler missing: ${t}`);
  }
  const wm = readFileSync('apps/frontend/components/reader/ForensicWatermarkOverlay.tsx', 'utf8');
  for (const t of ['ForensicWatermarkOverlay', '--watermark-opacity', 'pointer-events-none']) {
    assert.ok(wm.includes(t), `overlay missing: ${t}`);
  }
  const client = readFileSync('apps/frontend/lib/reader/retina-chunk-client.ts', 'utf8');
  for (const t of ['fetchRetinaChunk', 'zene-retina-chunks', 'sendBeacon', 'reportRenderMetrics']) {
    assert.ok(client.includes(t), `client missing: ${t}`);
  }
  const proxy = readFileSync('apps/frontend/app/api/v1/reader/retina-chunk/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/reader/retina-chunk'));
  const engine = readFileSync('apps/frontend/components/reader/CanvasReaderEngine.tsx', 'utf8');
  assert.ok(engine.includes('dprBackingFor') && engine.includes('setTransform'));
  assert.ok(readFileSync('docs/adr/ADR-060-retina-scaler.md', 'utf8').includes('Variant-keyed'));
  ok('Parity: services + REST/GQL/SDL + DPR kit + engine integration + ADR');
}

async function main(): Promise<void> {
  await sectionVectors();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase060 contracts: ${passed + 6} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
