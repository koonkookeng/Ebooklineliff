// SSOT Phase 036 §3.1 — R2 zero-egress storage Zod SSOT contract
// Canonical: packages/shared/src/schemas/r2-storage-contract.ts
// (legacy src/shared/schemas/r2-storage-contract.ts)
// - Spec-verbatim: StorageProviderEnum / MediaTypeEnum / R2ObjectMetadataSchema /
//   EbookChunkFetchRequestSchema / HlsStreamSignedUrlRequestSchema /
//   SignedStreamUrlResponseSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - productId/courseId/lessonId/sessionToken are min(1) strings, not uuid:
//     edge identity vocabulary (Phase 023–035 precedent).
//   - Adds R2UploadRequestSchema (creator presigned-POST intent, §3.2 mutation),
//     key-layout builders (chunkKey/hlsKey/signedTokenPayload) and TTL/budget
//     constants shared by the vault controller, the chunker/transcoder and the
//     frontend fetcher (single source, Gate 1).
// - Zero new deps (zod only).
import { z } from 'zod';

export const StorageProviderEnum = z.enum(['CLOUDFLARE_R2', 'REDIS_EDGE_CACHE', 'LOCAL_MOCK']);
export type StorageProvider = z.infer<typeof StorageProviderEnum>;

export const MediaTypeEnum = z.enum(['EBOOK_VECTOR_CHUNK', 'HLS_PLAYLIST', 'HLS_SEGMENT', 'PRODUCT_COVER', 'PAYMENT_SLIP']);
export type MediaType = z.infer<typeof MediaTypeEnum>;

export const R2ObjectMetadataSchema = z.object({
  bucketName: z.string().min(1),
  objectKey: z.string().min(1),
  contentLength: z.number().nonnegative(),
  contentType: z.string().min(1),
  eTag: z.string().min(1),
  sha256Hash: z.string().min(1),
  storageProvider: StorageProviderEnum.default('CLOUDFLARE_R2'),
});
export type R2ObjectMetadata = z.infer<typeof R2ObjectMetadataSchema>;

export const EbookChunkFetchRequestSchema = z.object({
  productId: z.string().min(1),
  chapterIndex: z.number().int().nonnegative().optional(),
  pageNumber: z.number().int().positive(),
  sessionToken: z.string().min(1).optional(),
});
export type EbookChunkFetchRequest = z.infer<typeof EbookChunkFetchRequestSchema>;

export const HlsQualityEnum = z.enum(['360p', '480p', '720p', '1080p', 'auto']);
export type HlsQuality = z.infer<typeof HlsQualityEnum>;

export const HlsStreamSignedUrlRequestSchema = z.object({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  qualityResolution: HlsQualityEnum.default('auto'),
});
export type HlsStreamSignedUrlRequest = z.infer<typeof HlsStreamSignedUrlRequestSchema>;

export const SignedStreamUrlResponseSchema = z.object({
  playlistUrl: z.string().url(),
  streamToken: z.string().min(8),
  expiresAt: z.string().datetime(),
  zeroEgressVerified: z.boolean().default(true),
});
export type SignedStreamUrlResponse = z.infer<typeof SignedStreamUrlResponseSchema>;

export const R2UploadRequestSchema = z.object({
  productId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  fileSizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  mimeType: z.string().min(1),
  mediaType: MediaTypeEnum,
});
export type R2UploadRequest = z.infer<typeof R2UploadRequestSchema>;

/** Default R2 vault bucket (§4.1). */
export const R2_DEFAULT_BUCKET = 'omni-commerce-vault';
/** Chunk edge-cache TTL: 24h (BDD Scenario 1). */
export const R2_CHUNK_CACHE_TTL_SEC = 86400;
/** HLS stream bearer token TTL: 60s (BDD Scenario 2). */
export const HLS_TOKEN_TTL_SEC = 60;
/** Free preview window: pages 1–10 without entitlement (vault + reader rule). */
export const R2_PREVIEW_MAX_PAGE = 10;
/** HLS rendition ladder (spec §5 transcoder outputs, kbps video targets). */
export const HLS_LADDER = [
  { resolution: '1080p', width: 1920, height: 1080, bandwidth: 5200000 },
  { resolution: '720p', width: 1280, height: 720, bandwidth: 2800000 },
  { resolution: '480p', width: 854, height: 480, bandwidth: 1400000 },
  { resolution: '360p', width: 640, height: 360, bandwidth: 800000 },
] as const;

/** R2 key for an ebook vector chunk: vault/ebooks/{productId}/chunks/page-{n}.svg.enc */
export function chunkObjectKey(productId: string, pageNumber: number): string {
  return `vault/ebooks/${productId}/chunks/page-${pageNumber}.svg.enc`;
}

/** R2 key prefix for a lesson: vault/hls/{lessonId}/ */
export function hlsObjectPrefix(lessonId: string): string {
  return `vault/hls/${lessonId}/`;
}

/** Edge-cache key for a chunk payload (BDD Scenario 1, <20ms path). */
export function chunkCacheKey(objectKey: string): string {
  return `r2:chunk:${objectKey}`;
}
