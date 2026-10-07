// SSOT Phase 041 §3.1 — Reader control Zod contract
// Canonical: packages/shared/src/schemas/reader-control-contract.ts
// (legacy src/shared/schemas/reader-control-contract.ts)
// - Spec-verbatim: ThemeModeEnum / ReaderPreferenceSchema /
//   BoundingBoxRectSchema / CreateBookmarkInputSchema /
//   CreateHighlightInputSchema (§3.1 Gate 1).
// - Additive (zero-dep): ANNOTATION_CACHE_TTL_SEC (1h, §5.1), theme/pref
//   helpers, ReaderPreferencePayloadSchema (GQL §3.2 output shape).
import { z } from 'zod';

export const ThemeModeEnum = z.enum(['LIGHT', 'DARK', 'SEPIA', 'OLED_BLACK']);
export type ThemeMode = z.infer<typeof ThemeModeEnum>;

export const ReaderPreferenceSchema = z.object({
  theme: ThemeModeEnum.default('LIGHT'),
  fontSizePx: z.number().int().min(12).max(36).default(18),
  fontFamily: z.enum(['TH Sarabun', 'Sukhumvit Set', 'Prompt', 'Serif', 'Sans-Serif']).default('Prompt'),
  lineSpacing: z.number().min(1.0).max(2.5).default(1.5),
  autoHideControls: z.boolean().default(true),
});
export type ReaderPreference = z.infer<typeof ReaderPreferenceSchema>;

export const BoundingBoxRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoundingBoxRect = z.infer<typeof BoundingBoxRectSchema>;

export const CreateBookmarkInputSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  chapterTitle: z.string().optional(),
});
export type CreateBookmarkInput = z.infer<typeof CreateBookmarkInputSchema>;

export const CreateHighlightInputSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  colorHex: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
  boundingRects: z.array(BoundingBoxRectSchema),
  selectedText: z.string().max(2000),
  noteText: z.string().max(1000).optional(),
});
export type CreateHighlightInput = z.infer<typeof CreateHighlightInputSchema>;

export const BookmarkToggleResultSchema = z.object({
  isBookmarked: z.boolean(),
  bookmark: z
    .object({
      id: z.string().min(1),
      pageNumber: z.number().int().positive(),
      chapterTitle: z.string().nullable().optional(),
      createdAt: z.string().datetime(),
    })
    .nullable(),
});
export type BookmarkToggleResult = z.infer<typeof BookmarkToggleResultSchema>;

/** §5.1 annotation container cache TTL (1h, Redis edge). */
export const ANNOTATION_CACHE_TTL_SEC = 3600;
/** BDD slider debounce: chunk fetch fires 300ms after scrub settles. */
export const PAGE_SLIDER_DEBOUNCE_MS = 300;
/** BDD overlay auto-hide: controls fade after 3s idle (bar uses 4s grace). */
export const CONTROLS_AUTOHIDE_MS = 3000;

/** Redis key for a user's per-book annotation container (§5.1). */
export function annotationCacheKey(userId: string, ebookId: string): string {
  return `user:${userId}:ebook:${ebookId}:annotations`;
}

/** Server default preferences (first-visit, pre-persist). */
export function defaultReaderPreference(): ReaderPreference {
  return ReaderPreferenceSchema.parse({});
}
