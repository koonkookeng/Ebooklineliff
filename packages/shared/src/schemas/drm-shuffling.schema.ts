// SSOT Phase 061 §3.1 — Dual DRM Canvas Shuffling contracts
// Canonical: packages/shared/src/schemas/drm-shuffling.schema.ts
// (legacy src/shared/schemas/drm-shuffling.schema.ts)
// - Verbatim shapes from §3.1: DrmShuffleAlgorithmEnum,
//   ShufflingMatrixSeed, EncryptedDrmChunkPayload.
// - Budgets: seed ≥32 chars; grid 4–32; session TTL 15min; signed blob URL
//   60s; violation log ≤500ms; deshuffle <16ms (60fps); RAM <30MB.
// - Browser-safe: pure Zod + deterministic permutation math shared by the
//   backend generator and the frontend deshuffler (byte-parity). Zero deps.
import { z } from 'zod';

export const DrmShuffleAlgorithmEnum = z.enum([
  'TILE_GRID_PERMUTATION',
  'PIXEL_BYTE_XOR_SHUFFLE',
  'HYBRID_WEBGL_MATRIX',
]);
export type DrmShuffleAlgorithm = z.infer<typeof DrmShuffleAlgorithmEnum>;

export const ShufflingMatrixSeedSchema = z.object({
  seed: z.string().min(32),
  gridX: z.number().int().min(4).max(32),
  gridY: z.number().int().min(4).max(32),
  permutationArray: z.array(z.number().int()),
  expiresAt: z.string().datetime(),
  sessionNonce: z.string().uuid(),
});
export type ShufflingMatrixSeed = z.infer<typeof ShufflingMatrixSeedSchema>;

export const EncryptedDrmChunkPayloadSchema = z.object({
  pageNumber: z.number().int().positive(),
  scrambledBlobUrl: z.string().url(),
  shufflingMatrix: ShufflingMatrixSeedSchema,
  forensicWatermark: z.object({
    watermarkText: z.string(),
    userIdHash: z.string(),
    userIp: z.string(),
    timestamp: z.string(),
  }),
  algorithm: DrmShuffleAlgorithmEnum,
});
export type EncryptedDrmChunkPayload = z.infer<typeof EncryptedDrmChunkPayloadSchema>;

// ---------- §1.3/§5.2/§7.1 budgets + permutation policy (single source) ----------
export const DRM_SEED_MIN_LEN = 32;
export const DRM_GRID_MIN = 4;
export const DRM_GRID_MAX = 32;
export const DRM_GRID_DEFAULT = 8;
export const DRM_SESSION_TTL_MIN = 15;
export const DRM_BLOB_URL_TTL_SEC = 60;
export const DRM_VIOLATION_BUDGET_MS = 500;
export const DRM_DESHUFFLE_BUDGET_MS = 16;
export const DRM_LIFF_RAM_MB = 30;
export const DRM_SESSION_CACHE_PREFIX = 'drm:session:';
export const DRM_VIOLATION_STREAM_KEY = 'stream:drm:violations';

export function drmSessionCacheKey(sessionNonce: string): string {
  return `${DRM_SESSION_CACHE_PREFIX}${sessionNonce}`;
}

/** LCG step (Numerical Recipes constants — mirrors the §5.2 generator). */
export function lcgNext(state: number): number {
  return (state * 1664525 + 1013904223) % 4294967296;
}

/** Deterministic Fisher-Yates permutation from a 64-hex HMAC seed. */
export function permutationFromSeed(seedHex: string, totalTiles: number): number[] {
  const perm = Array.from({ length: totalTiles }, (_, i) => i);
  let state = parseInt(seedHex.substring(0, 8), 16) >>> 0;
  for (let i = totalTiles - 1; i > 0; i--) {
    state = lcgNext(state);
    const j = Math.floor((state / 4294967296) * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

/** Inverse permutation for the deshuffle pass (dest → src). */
export function invertPermutation(perm: number[]): number[] {
  const inv = new Array<number>(perm.length);
  for (let src = 0; src < perm.length; src++) inv[perm[src]] = src;
  return inv;
}

/** Tile rectangles for an image box under a grid (CSS px, fractional-safe). */
export function tileRects(
  imgWidth: number,
  imgHeight: number,
  gridX: number,
  gridY: number,
): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  const tileW = imgWidth / gridX;
  const tileH = imgHeight / gridY;
  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      out.push({ x: col * tileW, y: row * tileH, w: tileW, h: tileH });
    }
  }
  return out;
}

/** True iff perm is a bijection over [0, n). */
export function isBijection(perm: number[]): boolean {
  const seen = new Set<number>();
  for (const v of perm) {
    if (!Number.isInteger(v) || v < 0 || v >= perm.length || seen.has(v)) return false;
    seen.add(v);
  }
  return seen.size === perm.length;
}
