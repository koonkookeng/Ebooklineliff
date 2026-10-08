// SSOT Phase 051 §10 — contract tests (Zod, gatekeeper, chunk, tokens, wiring)
// Run: npx tsx scripts/test-phase051-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PreviewContentTypeEnum,
  PreviewAccessCheckSchema,
  EbookPreviewChunkPayloadSchema,
  VideoPreviewStreamPayloadSchema,
  PaywallTriggerPayloadSchema,
  PreviewEventInputSchema,
  PREVIEW_EBOOK_DEFAULT_PAGES,
  PREVIEW_VIDEO_DEFAULT_SEC,
  PREVIEW_HLS_TOKEN_TTL_SEC,
  PREVIEW_ANALYTICS_TICK_SEC,
  previewChunkKey,
  previewUsageId,
  isEbookPageAllowed,
  isVideoSecondAllowed,
  previewLimitMessage,
  remainingQuotaLabel,
} from '../packages/shared/src/schemas/preview-contract';
import { PreviewGatekeeperService } from '../apps/backend/src/modules/preview/services/preview-gatekeeper.service';
import { EbookChunkService, hashPreviewIdentity } from '../apps/backend/src/modules/preview/services/ebook-chunk.service';
import { PreviewHlsTokenService } from '../apps/backend/src/modules/preview/services/hls-token.service';
import { previewIdentityOf } from '../apps/backend/src/modules/preview/preview-identity';
// NOTE: Controllers/PreviewModule/PreviewResolver carry Nest parameter decorators
// which tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–050 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';
const LESSON_ID = '323e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  assert.equal(PreviewContentTypeEnum.safeParse('EBOOK').success, true);
  assert.equal(PreviewContentTypeEnum.safeParse('ELEARNING_LESSON').success, true);
  assert.equal(PreviewContentTypeEnum.safeParse('VIDEO').success, false);

  assert.equal(
    PreviewAccessCheckSchema.safeParse({ productId: PRODUCT_ID, contentType: 'EBOOK', targetPage: 5 }).success,
    true,
  );
  assert.equal(
    PreviewAccessCheckSchema.safeParse({ productId: PRODUCT_ID, contentType: 'EBOOK', targetPage: 0 }).success,
    false,
  );

  const chunk = {
    productId: PRODUCT_ID,
    pageNumber: 3,
    totalPreviewPages: 10,
    isLastPreviewPage: false,
    vectorSvgContent: '<svg/>',
    forensicWatermarkData: { watermarkText: 'PREVIEW MODE - abc', userIdHash: 'abc', timestamp: '2026-01-01' },
    hasEntitlement: false,
  };
  assert.equal(EbookPreviewChunkPayloadSchema.safeParse(chunk).success, true);

  const stream = {
    lessonId: LESSON_ID,
    hlsPreviewPlaylistUrl: 'https://cdn.example.com/hls/preview.m3u8',
    previewToken: 'tok',
    hasEntitlement: false,
  };
  assert.equal(VideoPreviewStreamPayloadSchema.safeParse(stream).success, true);
  assert.equal(VideoPreviewStreamPayloadSchema.parse(stream).maxAllowedSeconds, 120);

  const paywall = {
    productId: PRODUCT_ID,
    productTitle: 'T',
    coverImageUrl: 'https://cdn.example.com/c.png',
    price: 299,
    discountPrice: null,
    previewLimitType: 'EBOOK',
    reachedLimitValue: '10 Pages',
    promptPayQrPayload: 'qr',
  };
  assert.equal(PaywallTriggerPayloadSchema.safeParse(paywall).success, true);

  const evt = { productId: PRODUCT_ID, contentType: 'EBOOK', reachedValue: 10, action: 'PAYWALL_TRIGGER' };
  assert.equal(PreviewEventInputSchema.safeParse(evt).success, true);
  assert.equal(PreviewEventInputSchema.safeParse({ ...evt, action: 'CLICK' }).success, false);

  assert.equal(PREVIEW_EBOOK_DEFAULT_PAGES, 10);
  assert.equal(PREVIEW_VIDEO_DEFAULT_SEC, 120);
  assert.equal(PREVIEW_HLS_TOKEN_TTL_SEC, 60);
  assert.equal(PREVIEW_ANALYTICS_TICK_SEC, 5);
  assert.equal(previewChunkKey('p', 3), 'preview:ebook:p:3');
  assert.equal(previewUsageId('EBOOK', 'u', 'p'), 'EBOOK:u:p');
  assert.equal(isEbookPageAllowed(1, 10), true);
  assert.equal(isEbookPageAllowed(10, 10), true);
  assert.equal(isEbookPageAllowed(11, 10), false);
  assert.equal(isEbookPageAllowed(0, 10), false);
  assert.equal(isVideoSecondAllowed(0, 120), true);
  assert.equal(isVideoSecondAllowed(119, 120), true);
  assert.equal(isVideoSecondAllowed(120, 120), false);
  assert.ok(previewLimitMessage('EBOOK', 10).includes('10 หน้า'));
  assert.ok(previewLimitMessage('ELEARNING_LESSON', 120).includes('2 นาที'));
  assert.equal(remainingQuotaLabel('EBOOK', 8, 10), 'ทดลองอ่าน หน้า 8/10');
  assert.equal(remainingQuotaLabel('ELEARNING_LESSON', 100, 120), 'ทดลองชมฟรี: 20 วินาทีที่เหลือ');
  ok('Zod preview/access/chunk/stream/paywall/event verbatim + budgets/helpers');
}

// ---------- 2. Gatekeeper (§5.2: entitlement bypass, 10-page cutoff, 120s fence) ----------
async function sectionGatekeeper(): Promise<void> {
  const lessons: Record<string, { isPreviewAllowed: boolean; previewLimitSec: number; durationSec: number }> = {
    [LESSON_ID]: { isPreviewAllowed: true, previewLimitSec: 120, durationSec: 1800 },
  };
  const entitled = new Set<string>();
  const logs = new Map<string, { maxPageReached: number; maxSecWatched: number }>();
  const emitted: string[] = [];
  const db = {
    entitlement: {
      findUnique: async (a: { where: { userId_productId: { userId: string; productId: string } } }) =>
        entitled.has(`${a.where.userId_productId.userId}:${a.where.userId_productId.productId}`) ? { id: 'e1' } : null,
    },
    ebookDetail: {
      findUnique: async (a: { where: { productId: string } }) =>
        a.where.productId === PRODUCT_ID ? { previewPages: 10 } : null,
    },
    courseLesson: {
      findUnique: async (a: { where: { id: string } }) => {
        const l = lessons[a.where.id];
        return l ? { id: a.where.id, ...l, section: { course: { productId: PRODUCT_ID } } } : null;
      },
    },
    previewUsageLog: {
      findUnique: async (a: { where: { id: string } }) => logs.get(a.where.id) ?? null,
      create: async (a: { data: Record<string, unknown> }) => {
        logs.set(a.data['id'] as string, {
          maxPageReached: (a.data['maxPageReached'] as number) ?? 0,
          maxSecWatched: (a.data['maxSecWatched'] as number) ?? 0,
        });
        return {};
      },
      update: async (a: { where: { id: string }; data: Record<string, number> }) => {
        logs.set(a.where.id, {
          maxPageReached: a.data['maxPageReached'] ?? 0,
          maxSecWatched: a.data['maxSecWatched'] ?? 0,
        });
        return {};
      },
    },
  };
  const svc = new PreviewGatekeeperService(db, { emit: async (m: string) => { emitted.push(m); } });

  // Anonymous page 1..10 allowed; page 11 ⇒ 403 PREVIEW_LIMIT_EXCEEDED.
  const anon = { userId: null };
  for (const p of [1, 10]) {
    const v = await svc.validateEbookPageAccess(anon, PRODUCT_ID, p);
    assert.equal(v.isPreviewMode, true);
    assert.equal(v.maxPreviewPages, 10);
    assert.equal(v.isLastPreviewPage, p === 10);
  }
  await assert.rejects(() => svc.validateEbookPageAccess(anon, PRODUCT_ID, 11), (e: unknown) => {
    const r = (e as { response?: { code?: string; maxAllowedPages?: number }; status?: number }).response;
    return r?.code === 'PREVIEW_LIMIT_EXCEEDED' && r?.maxAllowedPages === 10;
  });
  await assert.rejects(() => svc.validateEbookPageAccess(anon, 'nope-product', 1), /not found/);

  // Entitled ⇒ full access, no preview mode.
  entitled.add(`${USER_ID}:${PRODUCT_ID}`);
  const full = await svc.validateEbookPageAccess({ userId: USER_ID }, PRODUCT_ID, 250);
  assert.equal(full.isPreviewMode, false);

  // Video: preview fence 120s; entitled full duration; disallowed ⇒ 403.
  const pv = await svc.validateVideoPreviewAccess(anon, LESSON_ID);
  assert.equal(pv.isPreviewMode, true);
  assert.equal(pv.maxAllowedSec, 120);
  assert.equal(pv.productId, PRODUCT_ID);
  const fv = await svc.validateVideoPreviewAccess({ userId: USER_ID }, LESSON_ID);
  assert.equal(fv.isPreviewMode, false);
  assert.equal(fv.maxAllowedSec, 1800);
  lessons[LESSON_ID] = { isPreviewAllowed: false, previewLimitSec: 120, durationSec: 1800 };
  await assert.rejects(() => svc.validateVideoPreviewAccess(anon, LESSON_ID), (e: unknown) => {
    const r = (e as { response?: { message?: string } }).response;
    return typeof r?.message === 'string' && r.message.includes('ไม่อนุญาต');
  });
  await assert.rejects(() => svc.validateVideoPreviewAccess(anon, 'missing-lesson'), /Lesson not found/);

  // Engagement log: create → max-only update → invalid reject.
  assert.equal(
    await svc.recordPreviewEvent(anon, { productId: PRODUCT_ID, contentType: 'EBOOK', reachedValue: 4, action: 'PAGE_VIEW' }),
    true,
  );
  assert.equal(
    await svc.recordPreviewEvent(anon, { productId: PRODUCT_ID, contentType: 'EBOOK', reachedValue: 2, action: 'PAGE_VIEW' }),
    true,
  );
  const row = logs.get(`EBOOK:anon:${PRODUCT_ID}`);
  assert.equal(row?.maxPageReached, 4); // max semantics, not overwrite
  assert.equal(emitted.length, 2);
  await assert.rejects(
    () => svc.recordPreviewEvent(anon, { productId: 'bad', contentType: 'EBOOK', reachedValue: 1, action: 'PAGE_VIEW' }),
    /Invalid preview event/,
  );
  ok('Gatekeeper: anon 1-10 pass / 11→403+code / 404 / entitled bypass / video 120s fence / max-only log');
}

// ---------- 3. Chunk service (R2 path + 12-hex watermark, entitled shape) ----------
async function sectionChunk(): Promise<void> {
  assert.equal(hashPreviewIdentity('u1').length, 12);
  assert.notEqual(hashPreviewIdentity('u1'), hashPreviewIdentity('u2'));

  const gate = {
    validateEbookPageAccess: async (_id: unknown, _p: string, page: number) =>
      page > 10
        ? Promise.reject(Object.assign(new Error('limit'), { status: 403 }))
        : { isAllowed: true as const, isPreviewMode: page <= 10, maxPreviewPages: 10, isLastPreviewPage: page === 10 },
    validateVideoPreviewAccess: async () => ({ isAllowed: true as const, isPreviewMode: true, maxAllowedSec: 120, productId: PRODUCT_ID }),
    hasEntitlement: async () => false,
    recordPreviewEvent: async () => true,
  };
  const seen: string[] = [];
  const svc = new EbookChunkService(gate as never, {
    getObjectText: async (key: string) => {
      seen.push(key);
      return '<svg>page</svg>';
    },
  });
  const payload = await svc.getPreviewChunk({ userId: USER_ID }, PRODUCT_ID, 10);
  assert.equal(payload.pageNumber, 10);
  assert.equal(payload.totalPreviewPages, 10);
  assert.equal(payload.isLastPreviewPage, true);
  assert.equal(payload.vectorSvgContent, '<svg>page</svg>');
  assert.equal(payload.forensicWatermarkData.userIdHash.length, 12);
  assert.ok(payload.forensicWatermarkData.watermarkText.startsWith('PREVIEW MODE - '));
  assert.equal(payload.hasEntitlement, false);
  assert.deepEqual(seen, [`ebooks/${PRODUCT_ID}/pages/0010.svg`]);
  await assert.rejects(() => svc.getPreviewChunk({ userId: null }, PRODUCT_ID, 11), /limit/);
  ok('EbookChunkService: zero-padded R2 path + 12-hex watermark + last-page flag + 403 relay');
}

// ---------- 4. Preview HLS tokens (§8.1: 60s TTL, segment-bound, window trim) ----------
async function sectionTokens(): Promise<void> {
  const svc = new PreviewHlsTokenService('test-preview-secret-051');
  const tok = svc.mintSegmentToken(LESSON_ID, 'seg_00003.ts');
  svc.verifySegmentToken(tok, LESSON_ID, 'seg_00003.ts');
  assert.throws(() => svc.verifySegmentToken(tok, LESSON_ID, 'seg_00004.ts'), /scope mismatch/);
  assert.throws(() => svc.verifySegmentToken(tok, USER_ID, 'seg_00003.ts'), /scope mismatch/);
  assert.throws(() => svc.verifySegmentToken(`${tok}x`, LESSON_ID, 'seg_00003.ts'), /signature/);
  assert.throws(() => svc.verifySegmentToken('junk', LESSON_ID, 'seg_00003.ts'), /Invalid preview token/);
  const expired = svc.mintSegmentToken(LESSON_ID, 'seg_00003.ts', -5);
  assert.throws(() => svc.verifySegmentToken(expired, LESSON_ID, 'seg_00003.ts'), /expired/);
  const keyTok = svc.mintSegmentToken(LESSON_ID, 'key');
  svc.verifySegmentToken(keyTok, LESSON_ID, 'key');
  const plTok = svc.mintSegmentToken(LESSON_ID, 'playlist');
  svc.verifySegmentToken(plTok, LESSON_ID, 'playlist');

  // Window trim: 4s segments, 120s budget ⇒ first 30 media URIs survive.
  const segs = Array.from({ length: 40 }, (_, i) => `#EXTINF:4.0,\nseg_${String(i).padStart(5, '0')}.ts`).join('\n');
  const master = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="old/key"\n${segs}\n`;
  const trimmed = svc.buildPreviewPlaylist(LESSON_ID, 120, master);
  assert.ok(!trimmed.includes('seg_00030.ts'), 'segment past 120s window must be cut');
  assert.ok(trimmed.includes('seg_00029.ts?lessonId='), 'last in-window segment kept');
  assert.ok(trimmed.includes('/api/v1/preview/video/key?lessonId='), 'key URI rewritten to preview endpoint');
  assert.ok(!trimmed.includes('old/key'));

  const k1 = svc.derivePreviewKey(LESSON_ID);
  assert.equal(k1.length, 16);
  assert.deepEqual(k1, svc.derivePreviewKey(LESSON_ID));
  ok('PreviewHlsTokenService: sign/verify/expiry/scope + 120s window trim + key rewrite + 16B key');
}

// ---------- 5. Identity helper (JWT > header > anon) ----------
{
  assert.deepEqual(previewIdentityOf({ user: { id: USER_ID } }), { userId: USER_ID, lineUserId: undefined });
  assert.deepEqual(previewIdentityOf({ headers: { 'x-user-id': USER_ID } }), { userId: USER_ID, lineUserId: undefined });
  assert.deepEqual(previewIdentityOf({ headers: { 'x-line-user-id': 'line1' } }), { userId: null, lineUserId: 'line1' });
  assert.deepEqual(previewIdentityOf({}), { userId: null, lineUserId: undefined });
  ok('previewIdentityOf: JWT wins, header fallback, anon last');
}

// ---------- 6. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'previewPages  Int            @default(10)',
    'isPreviewAllowed Boolean @default(true)',
    'previewLimitSec  Int     @default(120)',
    'model PreviewUsageLog',
    'maxPageReached Int      @default(0)',
    'maxSecWatched  Int      @default(0)',
    'convertedToBuy Boolean  @default(false)',
    'previewLogs    PreviewUsageLog[]',
    '@@index([userId, productId])',
    '@@index([lineUserId])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: lesson preview cols + PreviewUsageLog + Product.previewLogs');
}

// ---------- 7. Static parity (controllers + module + resolver + SDL + proxies + UI) ----------
function sectionStaticParity(): void {
  const ebook = readFileSync('apps/backend/src/modules/preview/controllers/ebook-preview.controller.ts', 'utf8');
  for (const t of ["Controller('api/v1/preview/ebook')", "'chunk'", "'events'", 'previewIdentityOf']) {
    assert.ok(ebook.includes(t), `ebook controller missing: ${t}`);
  }
  const video = readFileSync('apps/backend/src/modules/preview/controllers/video-preview.controller.ts', 'utf8');
  for (const t of ["Controller('api/v1/preview/video')", "'stream'", "'playlist'", 'segments/:segmentName', "'key'", 'no-store']) {
    assert.ok(video.includes(t), `video controller missing: ${t}`);
  }
  const module = readFileSync('apps/backend/src/modules/preview/preview.module.ts', 'utf8');
  for (const t of ['PreviewGatekeeperService', 'EbookChunkService', 'PreviewHlsTokenService', 'PreviewResolver', 'R2StorageModule', 'useFactory', 'preview-events']) {
    assert.ok(module.includes(t), `module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('PreviewModule'));
  const alias1 = readFileSync('apps/backend/src/modules/entitlement/preview-gatekeeper.service.ts', 'utf8');
  assert.ok(alias1.includes("from '../preview/services/preview-gatekeeper.service'"));
  const alias2 = readFileSync('apps/backend/src/api/graphql/resolvers/preview.resolver.ts', 'utf8');
  assert.ok(alias2.includes('PreviewResolver'));

  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/preview.graphql/schema.graphql', 'utf8');
  for (const t of ['getEbookPreviewChunk', 'getVideoPreviewStream', 'recordPreviewEvent', 'PreviewEventInput', 'PAGE_VIEW']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }

  const files: Array<[string, string[]]> = [
    ['apps/frontend/app/api/v1/preview/ebook/chunk/route.ts', ['/api/v1/preview/ebook/chunk', '503']],
    ['apps/frontend/app/api/v1/preview/ebook/events/route.ts', ['/api/v1/preview/ebook/events', 'recorded']],
    ['apps/frontend/app/api/v1/preview/video/stream/route.ts', ['/api/v1/preview/video/stream', 'lessonId']],
    ['apps/frontend/app/api/v1/preview/video/playlist/route.ts', ['playlist', 'x-mpegURL', 'no-store']],
    ['apps/frontend/app/api/v1/preview/video/segments/[segmentName]/route.ts', ['/segments/', 'arrayBuffer', 'no-store']],
    ['apps/frontend/app/api/v1/preview/video/key/route.ts', ['/key?', 'arrayBuffer', 'no-store']],
  ];
  for (const [f, tokens] of files) {
    const src = readFileSync(f, 'utf8');
    for (const t of tokens) assert.ok(src.includes(t), `${f} missing: ${t}`);
  }

  const reader = readFileSync('apps/frontend/components/reader/CanvasPreviewReader.tsx', 'utf8');
  for (const t of ['PREVIEW_LIMIT_REACHED', 'revokeObjectURL', 'remainingQuotaLabel', 'PaywallModal', 'ทดลองอ่าน']) {
    assert.ok(reader.includes(t), `reader missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/player/HlsPreviewPlayer.tsx', 'utf8');
  for (const t of ['maxPreviewSec', 'PREVIEW_LIMIT_REACHED', 'destroyStream', 'remainingQuotaLabel', 'PaywallModal', 'nodownload', 'PAYWALL_TRIGGER']) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  const paywall = readFileSync('apps/frontend/components/checkout/PaywallModal.tsx', 'utf8');
  for (const t of ['backdrop-blur-md', 'reachedMessage', 'PromptPayQrDisplay', 'NativeActionButton', 'role="dialog"']) {
    assert.ok(paywall.includes(t), `paywall missing: ${t}`);
  }
  const page = readFileSync('apps/frontend/app/(liff)/preview/[productId]/page.tsx', 'utf8');
  for (const t of ['CanvasPreviewReader', 'Suspense', 'productId']) {
    assert.ok(page.includes(t), `liff page missing: ${t}`);
  }
  ok('Static parity: REST + module + aliases + GQL/SDL + 6 proxies + reader/player/paywall/page');
}

async function main(): Promise<void> {
  await sectionGatekeeper();
  await sectionChunk();
  await sectionTokens();
  sectionStaticParity();
}

void main();
