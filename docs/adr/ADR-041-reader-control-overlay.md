# ADR-041: Reader Control Overlay Engine (Bookmark/Highlight/Theme/Slider)

- Status: Accepted (Atomic Phase 041, PHASE-041-READER-CONTROLS)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/reader-control-contract.ts`
  (`ThemeModeEnum`, `ReaderPreferenceSchema`, `BoundingBoxRectSchema`,
  `CreateBookmarkInputSchema`, `CreateHighlightInputSchema`)
  + `packages/db/prisma/schema.prisma` (`EbookBookmark` @@unique[userId,ebookId,
  pageNumber], `EbookHighlight`, `UserReaderPreference` + User/EbookDetail
  back-relations; client regenerated, no data migration)

## Context

The LIFF/Web reader needs Kindle-grade controls (bookmark, highlight+note,
eye-care themes, precision slider) that stay under 30MB RAM, sync through the
edge cache, and never fork the Phase 039/040 transport or touch HLS/payment.

## Decision

1. **Persistence (§4.1 verbatim)**: three new Prisma models with cascade
   deletes; annotation reads go through a 1h `user:{u}:ebook:{e}:annotations`
   edge container (RedisClusterService, zero new pools), invalidated on every
   mutation; corrupt entries rebuild instead of throwing.
2. **Service semantics**: `toggleBookmark` is idempotent under concurrency
   (P2002 → existing row); `deleteHighlight` is ownership-checked;
   `getAnnotations` on unknown products returns empty (no leak);
   `getPreferences` defaults server-side and sanitizes out-of-vocabulary rows
   back to contract; every mutation emits a best-effort analytics event
   (BOOKMARK_TOGGLED / HIGHLIGHT_CREATED / THEME_PREFERENCE_CHANGED).
3. **Deliberate deviations (RISK_CALL, all additive)**:
   - No zustand/lucide-react/framer-motion (not in deps; LIFF budget): a
     zero-dep `useSyncExternalStore` store with the same §6.1 action surface,
     inline SVG icons, GPU translate/opacity transitions.
   - GQL `boundingRectsJson` travels as String (spec §3.2) while Zod validates
     the rect array at both REST and GQL boundaries (coerced from JSON text).
   - `ReaderControlResolver` lives at `api/graphql/reader-control.resolver.ts`
     (spec path) but is provided by `ReaderModule` (single ownership).
   - Highlight overlay uses relative 0..1 boxes (resolution-independent SVG
     mask) instead of absolute pixels.
4. **Client RAM**: store holds only annotation JSON (<0.5MB); slider commits
   debounce 300ms so the window fetcher only loads settled [N-1,N,N+1];
   overlay auto-hides on 4s idle; theme vars flip in one style pass (<16ms).
5. **Secrets/PII**: no userId/secret in logs (event sink carries ids only to
   the analytics pipeline, never to stdout).

## Consequences

- `scripts/test-phase041-contracts.ts`: 8 checks ×3 loops (incl. 50-drag
  <5MB store bound); regressions 038/039/040 green; frontend clean, backend 0
  new type errors (1 pre-existing legacy alias), Prisma valid + generated.
- Follow-ups (out of scope): highlight creation gesture wiring on the canvas
  (overlay renders saved data today), server push of queued offline bookmarks.
