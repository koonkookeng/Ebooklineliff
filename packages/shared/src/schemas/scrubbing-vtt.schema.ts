// SSOT Phase 058 §3.1 — High-Performance Video Thumbnail Scrubbing contracts
// Canonical: packages/shared/src/schemas/scrubbing-vtt.schema.ts
// (legacy src/shared/schemas/scrubbing-vtt.schema.ts)
// - Verbatim shapes from §3.1: ThumbnailCue, VideoSpriteManifest,
//   VideoScrubbingPayload (+ input alias for the GQL query).
// - Budgets: VTT manifest <15KB; sprite ≤250KB WebP; ≤2 sprites in RAM;
//   LIFF total <30MB strict; render <50ms; Redis manifest TTL 24h.
// - Browser-safe: pure Zod + string helpers (no node:crypto) so the LIFF
//   scrubbing bar can import cue math directly. Zero new deps.
import { z } from 'zod';

export const ThumbnailCueSchema = z.object({
  startTimeSec: z.number().min(0),
  endTimeSec: z.number().min(0),
  spriteUrl: z.string().url(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive().default(160),
  height: z.number().int().positive().default(90),
});
export type ThumbnailCue = z.infer<typeof ThumbnailCueSchema>;

export const VideoSpriteManifestSchema = z.object({
  lessonId: z.string().uuid(),
  vttUrl: z.string().url(),
  spriteIntervalSec: z.number().positive().default(2),
  tileWidth: z.number().int().positive().default(160),
  tileHeight: z.number().int().positive().default(90),
  columnsCount: z.number().int().positive().default(10),
  totalTiles: z.number().int().positive(),
  cues: z.array(ThumbnailCueSchema),
});
export type VideoSpriteManifest = z.infer<typeof VideoSpriteManifestSchema>;

export const VideoScrubbingPayloadSchema = z.object({
  success: z.boolean(),
  manifest: VideoSpriteManifestSchema.nullable(),
  watermarkText: z.string(),
  errorMessage: z.string().optional(),
});
export type VideoScrubbingPayload = z.infer<typeof VideoScrubbingPayloadSchema>;

export const ScrubbingManifestInputSchema = z.object({
  lessonId: z.string().uuid(),
});
export type ScrubbingManifestInput = z.infer<typeof ScrubbingManifestInputSchema>;

// ---------- §1.3/§2.1/§8 budgets + scrub math (single source) ----------
export const SCRUB_VTT_MAX_KB = 15;
export const SCRUB_SPRITE_MAX_KB = 250;
export const SCRUB_SPRITE_CACHE_LIMIT = 2;
export const SCRUB_LIFF_RAM_MB = 30;
export const SCRUB_RENDER_BUDGET_MS = 50;
export const SCRUB_MANIFEST_TTL_SEC = 86400;
export const SCRUB_TILE_W = 160;
export const SCRUB_TILE_H = 90;
export const SCRUB_COLS = 10;
export const SCRUB_INTERVAL_SEC = 2;
export const SCRUB_TILES_PER_SHEET = SCRUB_COLS * SCRUB_COLS;
export const SCRUB_MANIFEST_CACHE_KEY_PREFIX = 'scrubbing:manifest:';
export const SCRUB_ANALYTICS_STREAM_KEY = 'stream:scrub:seek-events';

export function scrubManifestCacheKey(lessonId: string): string {
  return `${SCRUB_MANIFEST_CACHE_KEY_PREFIX}${lessonId}`;
}

/** Tile coordinates for frame i (§5.2 cue math — pure, testable). */
export function cueCoordsForFrame(
  frameIndex: number,
  tileW: number = SCRUB_TILE_W,
  tileH: number = SCRUB_TILE_H,
  cols: number = SCRUB_COLS,
): { col: number; row: number; x: number; y: number; sheetIndex: number; tileIndexInSheet: number } {
  const sheetIndex = Math.floor(frameIndex / SCRUB_TILES_PER_SHEET);
  const tileIndexInSheet = frameIndex % SCRUB_TILES_PER_SHEET;
  const col = tileIndexInSheet % cols;
  const row = Math.floor(tileIndexInSheet / cols);
  return { col, row, x: col * tileW, y: row * tileH, sheetIndex, tileIndexInSheet };
}

/** Cumulative frame count for a lesson duration at the sprite interval. */
export function totalTilesFor(durationSec: number, intervalSec: number = SCRUB_INTERVAL_SEC): number {
  if (durationSec <= 0 || intervalSec <= 0) return 0;
  return Math.ceil(durationSec / intervalSec);
}

/** Cue lookup for hover timestamp T (last-cue fallback per BDD). */
export function cueForTime(cues: ThumbnailCue[], targetTimeSec: number): ThumbnailCue | null {
  if (cues.length === 0) return null;
  return cues.find((c) => targetTimeSec >= c.startTimeSec && targetTimeSec < c.endTimeSec) ?? cues[cues.length - 1];
}

/** WebVTT timestamp (MM:SS.mmm) for manifest generation. */
export function toVttTimestamp(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(m, 2)}:${pad(sec, 2)}.${pad(ms, 3)}`;
}

/** Human clock label rendered under the tooltip canvas (e.g. 08:42). */
export function formatScrubTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
