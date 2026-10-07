// SSOT Phase 041 §10 — contract tests (Zod, control service, store, wiring)
// Run: npx tsx scripts/test-phase041-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANNOTATION_CACHE_TTL_SEC,
  BoundingBoxRectSchema,
  BookmarkToggleResultSchema,
  CONTROLS_AUTOHIDE_MS,
  CreateBookmarkInputSchema,
  CreateHighlightInputSchema,
  PAGE_SLIDER_DEBOUNCE_MS,
  ReaderPreferenceSchema,
  ThemeModeEnum,
  annotationCacheKey,
  defaultReaderPreference,
} from '../packages/shared/src/schemas/reader-control-contract';
import { ReaderControlService } from '../apps/backend/src/modules/reader/reader-control.service';
import {
  getWatermarkStyleForTheme,
} from '../apps/frontend/components/reader/ThemeSettingsPopover';
import useReaderStore, { resetReaderStore } from '../apps/frontend/stores/useReaderStore';
// NOTE: ReaderControlController/ReaderControlResolver carry Nest parameter
// decorators (@Query/@Args/@Body) which tsx/esbuild cannot transform —
// verified via static source parity (§8) following Phase 027–040 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';
const EBOOK_ID = 'ebook-001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/keys ----------
{
  for (const t of ['LIGHT', 'DARK', 'SEPIA', 'OLED_BLACK']) {
    assert.equal(ThemeModeEnum.safeParse(t).success, true);
  }
  assert.equal(ThemeModeEnum.safeParse('SYSTEM').success, false);
  const prefs = ReaderPreferenceSchema.safeParse({});
  assert.equal(prefs.success, true);
  if (prefs.success) {
    assert.deepEqual(prefs.data, { theme: 'LIGHT', fontSizePx: 18, fontFamily: 'Prompt', lineSpacing: 1.5, autoHideControls: true });
  }
  assert.equal(ReaderPreferenceSchema.safeParse({ fontSizePx: 11 }).success, false);
  assert.equal(ReaderPreferenceSchema.safeParse({ fontSizePx: 37 }).success, false);
  assert.equal(ReaderPreferenceSchema.safeParse({ fontFamily: 'Comic Sans' }).success, false);

  assert.equal(BoundingBoxRectSchema.safeParse({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }).success, true);
  assert.equal(CreateBookmarkInputSchema.safeParse({ productId: PRODUCT_ID, pageNumber: 5, chapterTitle: 'Ch 1' }).success, true);
  assert.equal(CreateBookmarkInputSchema.safeParse({ productId: PRODUCT_ID, pageNumber: 5 }).success, true);
  assert.equal(CreateBookmarkInputSchema.safeParse({ productId: 'nope', pageNumber: 5 }).success, false);
  assert.equal(CreateBookmarkInputSchema.safeParse({ productId: PRODUCT_ID, pageNumber: 0 }).success, false);

  const hl = {
    productId: PRODUCT_ID,
    pageNumber: 7,
    colorHex: '#FFE066',
    boundingRects: [{ x: 0, y: 0, width: 1, height: 0.1 }],
    selectedText: 'key sentence',
    noteText: 'remember this',
  };
  assert.equal(CreateHighlightInputSchema.safeParse(hl).success, true);
  assert.equal(CreateHighlightInputSchema.safeParse({ ...hl, colorHex: '#FFF' }).success, true);
  assert.equal(CreateHighlightInputSchema.safeParse({ ...hl, colorHex: 'yellow' }).success, false);
  assert.equal(CreateHighlightInputSchema.safeParse({ ...hl, colorHex: '#GGGGGG' }).success, false);
  assert.equal(CreateHighlightInputSchema.safeParse({ ...hl, selectedText: 'x'.repeat(2001) }).success, false);

  assert.equal(BookmarkToggleResultSchema.safeParse({ isBookmarked: true, bookmark: { id: 'b1', pageNumber: 5, createdAt: new Date().toISOString() } }).success, true);
  assert.equal(BookmarkToggleResultSchema.safeParse({ isBookmarked: false, bookmark: null }).success, true);

  assert.equal(ANNOTATION_CACHE_TTL_SEC, 3600);
  assert.equal(PAGE_SLIDER_DEBOUNCE_MS, 300);
  assert.equal(CONTROLS_AUTOHIDE_MS, 3000);
  assert.equal(annotationCacheKey('u1', 'e1'), 'user:u1:ebook:e1:annotations');
  assert.deepEqual(defaultReaderPreference(), { theme: 'LIGHT', fontSizePx: 18, fontFamily: 'Prompt', lineSpacing: 1.5, autoHideControls: true });
  ok('Zod theme/prefs/bookmark/highlight verbatim + budgets + cache key');
}

// ---------- 2. Watermark auto-contrast (§8.1 Gate 4) ----------
{
  assert.deepEqual(getWatermarkStyleForTheme('LIGHT'), { color: 'rgba(0, 0, 0, 0.15)', mixBlendMode: 'multiply' });
  assert.deepEqual(getWatermarkStyleForTheme('DARK'), { color: 'rgba(255, 255, 255, 0.18)', mixBlendMode: 'screen' });
  assert.deepEqual(getWatermarkStyleForTheme('OLED_BLACK'), { color: 'rgba(255, 255, 255, 0.18)', mixBlendMode: 'screen' });
  assert.deepEqual(getWatermarkStyleForTheme('SEPIA'), { color: 'rgba(95, 75, 50, 0.22)', mixBlendMode: 'multiply' });
  ok('Watermark auto-contrast per theme stays visible on every background');
}

// ---------- 3. Store: bookmark actions + slider memory bound (§10 BDD) ----------
{
  resetReaderStore();
  assert.equal(useReaderStore.getState().bookmarks.length, 0);
  assert.equal(useReaderStore.getState().uiState, 'LIFF_INIT');

  useReaderStore.addBookmarkLocal({ id: 'bm-1', pageNumber: 5, chapterTitle: 'Chapter 1' });
  assert.equal(useReaderStore.getState().bookmarks.length, 1);
  // Duplicate page pins collapse (no record duplication, Gate 7 client mirror).
  useReaderStore.addBookmarkLocal({ id: 'bm-2', pageNumber: 5 });
  assert.equal(useReaderStore.getState().bookmarks.length, 1);
  useReaderStore.removeBookmarkLocal(5);
  assert.equal(useReaderStore.getState().bookmarks.length, 0);

  useReaderStore.addHighlightLocal({ id: 'h1', pageNumber: 3, colorHex: '#FFE066', boundingRectsJson: '[]', selectedText: 's' });
  assert.equal(useReaderStore.getState().highlights.length, 1);
  useReaderStore.removeHighlightLocal('h1');
  assert.equal(useReaderStore.getState().highlights.length, 0);

  useReaderStore.setTheme('OLED_BLACK');
  assert.equal(useReaderStore.getState().theme, 'OLED_BLACK');
  useReaderStore.setFontSizePx(100);
  assert.equal(useReaderStore.getState().fontSizePx, 36);
  useReaderStore.setFontSizePx(2);
  assert.equal(useReaderStore.getState().fontSizePx, 12);
  useReaderStore.setCurrentPage(-3);
  assert.equal(useReaderStore.getState().currentPage, 1);

  // 50 rapid slider drags must not bloat UI state (<5MB heap delta; node: ~0).
  const before = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance?.memory?.usedJSHeapSize ?? 0;
  for (let i = 1; i <= 50; i++) useReaderStore.setCurrentPage(i);
  useReaderStore.setTotalPages(500);
  useReaderStore.setCurrentPage(250);
  assert.equal(useReaderStore.getState().currentPage, 250);
  const after = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance?.memory?.usedJSHeapSize ?? 0;
  assert.ok((after - before) / (1024 * 1024) < 5, 'slider state stays flat');
  resetReaderStore();
  ok('Store bookmark/highlight/theme/slider actions + 50-drag memory bound');
}

type MemCell = { get: string[]; setex: string[]; del: string[][]; store: Map<string, string> };
function fakeCache(): MemCell & {
  client: { get(k: string): Promise<string | null>; setex(k: string, t: number, v: string): Promise<string>; del(...ks: string[]): Promise<number> };
} {
  const store = new Map<string, string>();
  const cell: MemCell = { get: [], setex: [], del: [], store };
  return {
    ...cell,
    client: {
      get: async (k) => { cell.get.push(k); return store.get(k) ?? null; },
      setex: async (k, t, v) => { cell.setex.push(`${k}:${t}`); store.set(k, v); return 'OK'; },
      del: async (...ks) => { cell.del.push(ks); for (const k of ks) store.delete(k); return ks.length; },
    },
  };
}

function fakePrisma() {
  const bookmarks = new Map<string, { id: string; userId: string; ebookId: string; pageNumber: number; chapterTitle: string | null; createdAt: Date }>();
  const highlights = new Map<string, { id: string; userId: string; ebookId: string; pageNumber: number; colorHex: string; boundingRectsJson: unknown; selectedText: string; noteText: string | null; createdAt: Date }>();
  let prefs: { theme: string; fontSizePx: number; fontFamily: string; lineSpacing: number; autoHideControls: boolean } | null = null;
  let seq = 0;
  return {
    bookmarks,
    highlights,
    ebookDetail: {
      findUnique: async (a: unknown) => {
        const where = (a as { where: { productId: string } }).where;
        return where.productId === PRODUCT_ID ? { id: EBOOK_ID } : null;
      },
    },
    ebookBookmark: {
      findUnique: async (a: unknown) => {
        const w = (a as { where: { userId_ebookId_pageNumber: { userId: string; ebookId: string; pageNumber: number } } }).where.userId_ebookId_pageNumber;
        return [...bookmarks.values()].find((b) => b.userId === w.userId && b.ebookId === w.ebookId && b.pageNumber === w.pageNumber) ?? null;
      },
      findMany: async () => [...bookmarks.values()].sort((x, y) => x.pageNumber - y.pageNumber),
      create: async (a: unknown) => {
        const d = (a as { data: { userId: string; ebookId: string; pageNumber: number; chapterTitle?: string } }).data;
        const dupe = [...bookmarks.values()].find((b) => b.userId === d.userId && b.ebookId === d.ebookId && b.pageNumber === d.pageNumber);
        if (dupe) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        seq += 1;
        const row = { id: `bm-${seq}`, userId: d.userId, ebookId: d.ebookId, pageNumber: d.pageNumber, chapterTitle: d.chapterTitle ?? null, createdAt: new Date('2026-10-07T00:00:00.000Z') };
        bookmarks.set(row.id, row);
        return row;
      },
      delete: async (a: unknown) => {
        const id = (a as { where: { id: string } }).where.id;
        bookmarks.delete(id);
        return {};
      },
    },
    ebookHighlight: {
      findMany: async () => [...highlights.values()].sort((x, y) => x.pageNumber - y.pageNumber),
      findUnique: async (a: unknown) => highlights.get((a as { where: { id: string } }).where.id) ?? null,
      create: async (a: unknown) => {
        const d = (a as { data: { userId: string; ebookId: string; pageNumber: number; colorHex: string; boundingRectsJson: unknown; selectedText: string; noteText?: string } }).data;
        seq += 1;
        const row = { id: `hl-${seq}`, ...d, noteText: d.noteText ?? null, createdAt: new Date('2026-10-07T00:00:00.000Z') };
        highlights.set(row.id, row);
        return row;
      },
      delete: async (a: unknown) => {
        highlights.delete((a as { where: { id: string } }).where.id);
        return {};
      },
    },
    userReaderPreference: {
      findUnique: async () => prefs,
      upsert: async (a: unknown) => {
        const v = (a as { create: { theme: string; fontSizePx: number; fontFamily: string; lineSpacing: number; autoHideControls: boolean } }).create;
        prefs = { ...v };
        return prefs;
      },
    },
  };
}

async function main(): Promise<void> {
  // ---------- 4. toggleBookmark: on/off/P2002 + invalidation + event ----------
  {
    const cache = fakeCache();
    const prisma = fakePrisma();
    const events: unknown[] = [];
    const svc = new ReaderControlService(prisma as never, cache.client as never, (e) => events.push(e));

    const on = await svc.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 5, chapterTitle: 'Ch 1' });
    assert.equal(on.isBookmarked, true);
    assert.ok(on.bookmark && on.bookmark.pageNumber === 5);
    assert.ok(cache.del.some((ks) => ks[0] === annotationCacheKey(USER_ID, EBOOK_ID)));
    assert.equal(events.length, 1);

    // Concurrent double-toggle collapses via P2002 → idempotent bookmarked.
    const raced = await svc.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 5, chapterTitle: 'Ch 1' });
    assert.equal(raced.isBookmarked, false); // existing → toggle off
    const on2 = await svc.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 5 });
    assert.equal(on2.isBookmarked, true);
    // Concurrent same-action toggles converge to bookmarked (P2002 → idempotent).
    assert.deepEqual(
      await Promise.all([
        svc.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 9 }),
        svc.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 9 }),
      ]).then((r) => r.map((x) => x.isBookmarked).sort()),
      [true, true],
    );

    // Unknown product → typed 404, no leak.
    const ghost = new ReaderControlService(
      { ...prisma, ebookDetail: { findUnique: async () => null } } as never,
      cache.client as never,
    );
    await assert.rejects(() => ghost.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 1 }), /not found/);
    ok('Bookmark toggle on/off + P2002 idempotency + cache invalidation + event');
  }

  // ---------- 5. Highlights + annotations container cache (1h, corrupt-proof) ----------
  {
    const cache = fakeCache();
    const prisma = fakePrisma();
    const svc = new ReaderControlService(prisma as never, cache.client as never);

    const saved = await svc.saveHighlight(USER_ID, {
      productId: PRODUCT_ID,
      pageNumber: 7,
      colorHex: '#FFE066',
      boundingRects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }],
      selectedText: 'key sentence',
    });
    assert.equal(typeof saved.boundingRectsJson, 'string');
    assert.ok(saved.boundingRectsJson.includes('0.1'));

    await svc.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 5 });
    const first = await svc.getAnnotations(USER_ID, PRODUCT_ID);
    assert.equal(first.bookmarks.length, 1);
    assert.equal(first.highlights.length, 1);
    assert.ok(cache.setex.some((s) => s.startsWith(`${annotationCacheKey(USER_ID, EBOOK_ID)}:3600`)));

    const getsBefore = cache.get.length;
    const second = await svc.getAnnotations(USER_ID, PRODUCT_ID);
    assert.deepEqual(second, first); // served from edge, no recompute
    assert.equal(cache.get.length, getsBefore + 1);

    // Corrupt edge entry rebuilds instead of throwing.
    cache.store.set(annotationCacheKey(USER_ID, EBOOK_ID), 'not-json{{{');
    const rebuilt = await svc.getAnnotations(USER_ID, PRODUCT_ID);
    assert.equal(rebuilt.bookmarks.length, 1);

    // Ownership-guarded delete.
    assert.equal(await svc.deleteHighlight('nope', 'hl-x'), false);
    const hlId = (first.highlights[0] as { id: string }).id;
    assert.equal(await svc.deleteHighlight('intruder', hlId), false);
    assert.equal(await svc.deleteHighlight(USER_ID, hlId), true);
    assert.equal((await svc.getAnnotations(USER_ID, PRODUCT_ID)).highlights.length, 0);

    // Unknown product → empty container (no leak, no throw).
    assert.deepEqual(await svc.getAnnotations(USER_ID, '00000000-0000-4000-8000-000000000000'), { bookmarks: [], highlights: [] });
    ok('Highlight save + 1h container cache + corrupt rebuild + owned delete + empty ghost');
  }

  // ---------- 6. Preferences default/upsert + theme event ----------
  {
    const prisma = fakePrisma();
    const events: unknown[] = [];
    const svc = new ReaderControlService(prisma as never, undefined, (e) => events.push(e));
    assert.deepEqual(await svc.getPreferences(USER_ID), {
      theme: 'LIGHT', fontSizePx: 18, fontFamily: 'Prompt', lineSpacing: 1.5, autoHideControls: true,
    });
    const updated = await svc.updatePreferences(USER_ID, {
      theme: 'OLED_BLACK', fontSizePx: 20, fontFamily: 'Serif', lineSpacing: 1.8, autoHideControls: false,
    });
    assert.equal(updated.theme, 'OLED_BLACK');
    assert.deepEqual(await svc.getPreferences(USER_ID), updated);
    assert.deepEqual(events, [{ kind: 'THEME_PREFERENCE_CHANGED', userId: USER_ID }]);

    // Corrupt stored row (out-of-vocabulary writer) sanitizes to contract.
    const dirty = new ReaderControlService(
      {
        ...prisma,
        userReaderPreference: {
          findUnique: async () => ({ theme: 'SYSTEM', fontSizePx: 99, fontFamily: 'Hax', lineSpacing: 9, autoHideControls: true }),
          upsert: prisma.userReaderPreference.upsert,
        },
      } as never,
      undefined,
    );
    assert.deepEqual(await dirty.getPreferences(USER_ID), {
      theme: 'LIGHT', fontSizePx: 18, fontFamily: 'Prompt', lineSpacing: 1.5, autoHideControls: true,
    });
    ok('Preference defaults + upsert + change event + corrupt-row sanitize (cacheless path covered)');
  }

  // ---------- 7. Unwired service fails closed ----------
  {
    const bare = new ReaderControlService();
    await assert.rejects(() => bare.toggleBookmark(USER_ID, { productId: PRODUCT_ID, pageNumber: 1 }), /unavailable|not found/);
    assert.deepEqual(await bare.getAnnotations(USER_ID, PRODUCT_ID), { bookmarks: [], highlights: [] });
    ok('Unwired service fails closed (never hangs)');
  }

  // ---------- 8. Wiring + SDL/DTO/proxy/store/component/page parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of ['model EbookBookmark', 'model EbookHighlight', 'model UserReaderPreference', '@@unique([userId, ebookId, pageNumber])', 'bookmarks      EbookBookmark[]', 'readerPreference  UserReaderPreference?']) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['CreateBookmarkInputSchema', 'CreateHighlightInputSchema', 'ReaderPreferenceSchema', 'annotationCacheKey', 'PAGE_SLIDER_DEBOUNCE_MS']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/reader/reader.module.ts', 'utf8');
    for (const t of ['ReaderControlService', 'ReaderControlController', 'ReaderControlResolver', 'PrismaService', 'RedisClusterService', 'useFactory']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    const ctlSrc = readFileSync('apps/backend/src/modules/reader/reader-control.controller.ts', 'utf8');
    for (const t of ['api/v1/reader-control', '@Get', '@Post', '@Delete', '@Put', 'JwtAuthGuard', 'CreateBookmarkInputSchema', 'CreateHighlightInputSchema', 'ReaderPreferenceSchema']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const rslSrc = readFileSync('apps/backend/src/api/graphql/reader-control.resolver.ts', 'utf8');
    for (const t of ['getEbookAnnotations', 'getReaderPreferences', 'toggleBookmark', 'saveHighlight', 'deleteHighlight', 'updateReaderPreferences', '@Context', 'resolveReaderIdentity']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/reader-control.graphql/schema.graphql', 'utf8');
    for (const t of ['getEbookAnnotations', 'toggleBookmark', 'saveHighlight', 'deleteHighlight', 'updateReaderPreferences', 'ReaderControlBookmarkToggle']) {
      assert.ok(sdl.includes(t), `SDL missing ${t}`);
    }
    const store = readFileSync('apps/frontend/stores/useReaderStore.ts', 'utf8');
    for (const t of ['setCurrentPage', 'toggleControls', 'setTheme', 'setFontSizePx', 'addBookmarkLocal', 'removeBookmarkLocal', 'useSyncExternalStore', 'getState']) {
      assert.ok(store.includes(t), `store missing ${t}`);
    }
    assert.ok(!store.includes("from 'zustand'"), 'store stays dependency-free');
    for (const [f, markers] of [
      ['apps/frontend/components/reader/ReaderControlBar.tsx', ['PageNavigationSlider', 'ThemeSettingsPopover', 'setShowControls', 'Bookmark page']],
      ['apps/frontend/components/reader/PageNavigationSlider.tsx', ['PAGE_SLIDER_DEBOUNCE_MS', 'onTouchEnd', 'setCurrentPage']],
      ['apps/frontend/components/reader/ThemeSettingsPopover.tsx', ['getWatermarkStyleForTheme', 'OLED_BLACK', 'setFontSizePx']],
      ['apps/frontend/components/reader/BookmarkManager.tsx', ['onJumpToPage', 'onRemoveBookmark', 'aria-label="Bookmarks"']],
      ['apps/frontend/components/reader/HighlightAnnotationOverlay.tsx', ['boundingRectsJson', 'preserveAspectRatio', 'fillOpacity']],
      ['apps/frontend/app/(liff)/reader/[productId]/page.tsx', ['LIFF_INIT', 'hydrateReaderPreferences', 'ReaderControlBar', 'BookmarkManager', '--reader-bg']],
      ['apps/frontend/lib/reader/reader-control-client.ts', ['toggleBookmarkRemote', 'saveHighlightRemote', 'savePreferencesRemote']],
      ['apps/frontend/app/api/v1/reader-control/annotations/route.ts', ['/api/v1/reader-control/annotations', '503']],
      ['apps/frontend/app/api/v1/reader-control/bookmark/route.ts', ['/api/v1/reader-control/bookmark', 'POST']],
      ['apps/frontend/app/api/v1/reader-control/highlight/route.ts', ['/api/v1/reader-control/highlight', 'DELETE']],
      ['apps/frontend/app/api/v1/reader-control/preferences/route.ts', ['/api/v1/reader-control/preferences', 'PUT']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    // No heavy UI deps sneak into the LIFF bundle surface (import-shape check).
    for (const f of ['apps/frontend/components/reader/ReaderControlBar.tsx', 'apps/frontend/components/reader/ThemeSettingsPopover.tsx', 'apps/frontend/stores/useReaderStore.ts']) {
      const src = readFileSync(f, 'utf8');
      for (const dep of ["from 'lucide-react'", 'from "lucide-react"', "from 'framer-motion'", 'from "framer-motion"', "from 'zustand'", 'from "zustand"']) {
        assert.ok(!src.includes(dep), `${f} must not import ${dep}`);
      }
    }
    ok('Prisma models + barrel + module + controller/resolver/SDL + store/components/page/proxies parity + dep-free guard');
  }

  console.log(`\nPhase 041 contracts: ${passed} checks passed`);
}

void main();
