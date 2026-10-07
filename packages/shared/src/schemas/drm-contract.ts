// SSOT Phase 049 §3.1 — DRM Canvas Shuffling Zod contract
// Canonical: packages/shared/src/schemas/drm-contract.ts
// (legacy src/shared/schemas/drm-contract.ts)
// - Spec-verbatim: DrmSecurityLevelEnum / PixelTileMatrixSchema /
//   DrmSessionHandshakeSchema / ForensicPayloadSchema /
//   DecryptChunkPayloadSchema (§3.1 Gate 1).
// - Additive (zero-dep): session TTL, key builders, hash helpers,
//   permutation invert/validate, LSB capacity math.
// - Zero new deps (zod only).
import { z } from 'zod';

export const DrmSecurityLevelEnum = z.enum([
  'STANDARD_WATERMARK',
  'PIXEL_SHUFFLE_LSB',
  'HIGH_SECURITY_FORENSIC',
]);
export type DrmSecurityLevel = z.infer<typeof DrmSecurityLevelEnum>;

export const DrmViolationTypeEnum = z.enum([
  'SCREENSHOT_ATTEMPT',
  'DEVTOOLS_CANVAS_DUMP',
  'UNAUTHORIZED_DOM_INJECTION',
  'SESSION_HIJACK_ATTEMPT',
]);
export type DrmViolationType = z.infer<typeof DrmViolationTypeEnum>;

export const PixelTileMatrixSchema = z.object({
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  gridCols: z.number().int().positive(),
  gridRows: z.number().int().positive(),
  permutationVector: z.array(z.number().int().nonnegative()),
  seedHash: z.string().min(32),
});
export type PixelTileMatrix = z.infer<typeof PixelTileMatrixSchema>;

export const DrmSessionHandshakeSchema = z.object({
  sessionId: z.string().uuid(),
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  tileMatrix: PixelTileMatrixSchema,
});
export type DrmSessionHandshake = z.infer<typeof DrmSessionHandshakeSchema>;

export const ForensicPayloadSchema = z.object({
  userIdHash: z.string(),
  tenantId: z.string(),
  ipAddressHash: z.string(),
  timestamp: z.string(),
});
export type ForensicPayload = z.infer<typeof ForensicPayloadSchema>;

export const DecryptChunkPayloadSchema = z.object({
  pageNumber: z.number().int().positive(),
  encryptedChunkUrl: z.string().url(),
  drmSession: DrmSessionHandshakeSchema,
  forensicData: ForensicPayloadSchema,
});
export type DecryptChunkPayload = z.infer<typeof DecryptChunkPayloadSchema>;

// ---------- Additive budgets/keys (Phase 049 §8: TTL 15min, 64px tiles) ----------

/** §8.2 Ephemeral session TTL: 15 minutes. */
export const DRM_SESSION_TTL_SEC = 15 * 60;
/** §5.1 Optimal mobile tile size (px). Self-heal fallback doubles to 128. */
export const DRM_TILE_SIZE = 64;
export const DRM_TILE_SIZE_FALLBACK = 128;
/** §7.1 Pixel-scrape anomaly threshold: >5 pulls/sec revokes the session. */
export const DRM_PIXEL_SCRAPE_LIMIT_PER_SEC = 5;
/** 60 FPS frame budget (ms). */
export const DRM_FRAME_BUDGET_MS = 16.6;
/** LIFF RAM ceiling shared with reader engine. */
export const DRM_RAM_BUDGET_MB = 30;

/** Redis key for a live DRM session payload. */
export function drmSessionKey(sessionId: string): string {
  return `drm:session:${sessionId}`;
}

/** Redis key for per-session pixel-pull rate counting. */
export function drmPixelRateKey(sessionId: string): string {
  return `drm:pixel-rate:${sessionId}`;
}

/** Redis key for per-session violation counters (§7.1 telemetry). */
export function drmViolationKey(sessionId: string): string {
  return `drm:violations:${sessionId}`;
}

/** Session expiry timestamp (ISO) TTL seconds from now. */
export function drmSessionExpiry(ttlSec: number = DRM_SESSION_TTL_SEC): string {
  return new Date(Date.now() + ttlSec * 1000).toISOString();
}

/** Validate that a permutation vector is a bijection of [0, n). */
export function isValidPermutation(permutationVector: number[]): boolean {
  const n = permutationVector.length;
  if (n === 0) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const v of permutationVector) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

/**
 * Invert a permutation: scrambledIndex -> originalIndex becomes
 * originalIndex -> scrambledIndex (worker descramble addressing).
 */
export function invertPermutation(permutationVector: number[]): number[] {
  const inverse = new Array<number>(permutationVector.length);
  for (let scrambled = 0; scrambled < permutationVector.length; scrambled++) {
    inverse[permutationVector[scrambled]] = scrambled;
  }
  return inverse;
}

/** Grid dimensions for an image at a given tile size. */
export function tileGrid(imageWidth: number, imageHeight: number, tileSize: number = DRM_TILE_SIZE): {
  gridCols: number;
  gridRows: number;
  totalTiles: number;
} {
  const gridCols = Math.ceil(imageWidth / tileSize);
  const gridRows = Math.ceil(imageHeight / tileSize);
  return { gridCols, gridRows, totalTiles: gridCols * gridRows };
}

/** LSB alpha-channel capacity: 1 char per 3-px group (8 bits over 3+3+2). */
export function lsbCapacityChars(viewportWidth: number, viewportHeight: number): number {
  return Math.floor((viewportWidth * viewportHeight) / 3);
}

// ---------- LSB forensic steganography (pure byte ops, shared engine) ----------
// Spec §6.2/§8.3: low bits of each pixel's Alpha channel carry the payload.
// Char i occupies its own 3-pixel group (pixels 3i, 3i+1, 3i+2 → 3+3+2 bits).
// Single implementation shared by the Web Worker (embed) and the backend
// forensic extractor (verify) — no duplicated shuffle/pixel logic.

/**
 * Embed a payload into RGBA bytes (alpha LSBs). Mutates `rgba` in place.
 * Returns the number of payload chars written.
 */
export function embedLsb(rgba: Uint8Array | number[], payload: string): number {
  const groups = Math.floor(Math.floor(rgba.length / 4) / 3);
  const n = Math.min(payload.length, groups);
  for (let i = 0; i < n; i++) {
    const charCode = payload.charCodeAt(i) & 0xff;
    const a0 = i * 3 * 4 + 3;
    const a1 = (i * 3 + 1) * 4 + 3;
    const a2 = (i * 3 + 2) * 4 + 3;
    rgba[a0] = (rgba[a0] & 0xf8) | ((charCode >> 5) & 0x07);
    rgba[a1] = (rgba[a1] & 0xf8) | ((charCode >> 2) & 0x07);
    rgba[a2] = (rgba[a2] & 0xfc) | (charCode & 0x03);
  }
  return n;
}

/** Extract a payload of `length` chars from RGBA alpha LSBs. */
export function extractLsb(rgba: Uint8Array | number[], length: number): string {
  const groups = Math.floor(Math.floor(rgba.length / 4) / 3);
  const n = Math.min(length, groups);
  let out = '';
  for (let i = 0; i < n; i++) {
    const hi = (rgba[i * 3 * 4 + 3] & 0x07) << 5;
    const mid = (rgba[(i * 3 + 1) * 4 + 3] & 0x07) << 2;
    const lo = rgba[(i * 3 + 2) * 4 + 3] & 0x03;
    out += String.fromCharCode(hi | mid | lo);
  }
  return out;
}
