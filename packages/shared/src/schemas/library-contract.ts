// SSOT Phase 018 §3.1 — My Library (digital assets entitlement) Zod domain contract
// Canonical: packages/shared/src/schemas/library-contract.ts
// (legacy src/shared/schemas/library-contract.ts)
// Zero-redundant: accessType reuses ContentAccessTypeEnum from ./sdid-contract.
import { z } from 'zod';
import { ContentAccessTypeEnum } from './sdid-contract';

export { ContentAccessTypeEnum };

export const AssetTypeEnum = z.enum(['EBOOK', 'ELEARNING_COURSE', 'HYBRID_BUNDLE', 'LIVE_CLASS']);
export type AssetType = z.infer<typeof AssetTypeEnum>;

export const AssetSortEnum = z.enum(['RECENTLY_ACCESSED', 'TITLE_ASC', 'PURCHASE_DATE_DESC', 'PROGRESS_ASC']);
export type AssetSort = z.infer<typeof AssetSortEnum>;

export const DigitalAssetSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  title: z.string(),
  coverImageUrl: z.string().url(),
  assetType: AssetTypeEnum,
  accessType: ContentAccessTypeEnum,
  expiresAt: z.string().datetime().nullable(),
  progressPercentage: z.number().min(0).max(100),
  lastAccessedPage: z.number().int().optional(),
  lastAccessedTimeSec: z.number().int().optional(),
  totalUnits: z.number().int(),
  completedUnits: z.number().int(),
  lastAccessedAt: z.string().datetime(),
  isDownloadAvailableOffline: z.boolean().default(false),
});
export type DigitalAsset = z.infer<typeof DigitalAssetSchema>;

export const MyLibraryQueryInputSchema = z.object({
  assetType: AssetTypeEnum.optional(),
  searchQuery: z.string().max(100).optional(),
  sortBy: AssetSortEnum.default('RECENTLY_ACCESSED'),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(12),
});
export type MyLibraryQueryInput = z.infer<typeof MyLibraryQueryInputSchema>;

export const MyLibraryPayloadSchema = z.object({
  assets: z.array(DigitalAssetSchema),
  totalCount: z.number().int().nonnegative(),
  currentPage: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  hasMore: z.boolean(),
});
export type MyLibraryPayload = z.infer<typeof MyLibraryPayloadSchema>;

/** Redis edge-cache TTL for library payloads (spec §5.2: 60s). */
export const LIBRARY_CACHE_TTL_SEC = 60;
/** Cache-key namespace for per-user filtered library payloads. */
export function libraryCacheKey(userId: string, input: MyLibraryQueryInput): string {
  return `user:${userId}:library:${JSON.stringify(input)}`;
}
/** Real-time entitlement gatekeeper flag (1ms check before reader/player). */
export function libraryGateKey(userId: string, productId: string): string {
  return `library:gate:${userId}:${productId}`;
}
