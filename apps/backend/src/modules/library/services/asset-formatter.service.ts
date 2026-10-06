// SSOT Phase 018 §5 — Asset formatting rules engine (pure, testable, no I/O)
// Canonical: apps/backend/src/modules/library/services/asset-formatter.service.ts
// (legacy src/backend/modules/library/services/asset-formatter.service.ts)
import { Injectable } from '@nestjs/common';
import { AssetTypeEnum, ContentAccessTypeEnum, type AssetType, type DigitalAsset } from '@repo/shared';

export interface EntitlementRow {
  id: string;
  productId: string;
  accessType: string;
  expiresAt: Date | null;
  updatedAt: Date;
  product: {
    title: string;
    coverImageUrl: string;
    productType: string;
    ebookDetail: { totalPages: number } | null;
    courseDetail: { sections: Array<{ lessons: Array<{ id: string }> }> } | null;
  };
}

export interface EbookProgressRow {
  ebookId: string;
  lastPage: number;
  totalPages: number;
}

export interface CourseProgressRow {
  lessonId: string;
  watchedSec: number;
  isCompleted: boolean;
  updatedAt: Date;
}

/** Library-visible product types (PHYSICAL_BOOK never appears in My Library). */
export function toAssetType(productType: string): AssetType | null {
  const parsed = AssetTypeEnum.safeParse(productType);
  return parsed.success ? parsed.data : null;
}

/** Clamped 0–100 completion percentage (satan-safe rounding). */
export function progressPct(completed: number, total: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
}

function iso(d: Date): string {
  return d instanceof Date ? d.toISOString() : new Date().toISOString();
}

@Injectable()
export class AssetFormatterService {
  /** Builds one DigitalAsset from an entitlement + batched progress maps (no I/O). */
  format(
    ent: EntitlementRow,
    ebookByProduct: Map<string, EbookProgressRow>,
    courseByLesson: Map<string, CourseProgressRow>,
  ): DigitalAsset | null {
    const assetType = toAssetType(ent.product.productType);
    if (!assetType) return null;
    const access = ContentAccessTypeEnum.safeParse(ent.accessType);
    if (!access.success) return null;
    const base = {
      id: ent.id,
      productId: ent.productId,
      title: ent.product.title,
      coverImageUrl: ent.product.coverImageUrl,
      assetType,
      accessType: access.data,
      expiresAt: ent.expiresAt ? iso(ent.expiresAt) : null,
      lastAccessedAt: iso(ent.updatedAt),
      isDownloadAvailableOffline: true,
    };
    if (assetType === 'EBOOK') {
      const totalUnits = Math.max(1, ent.product.ebookDetail?.totalPages ?? 1);
      const progress = ebookByProduct.get(ent.productId);
      const completedUnits = Math.min(progress?.lastPage ?? 0, totalUnits);
      return {
        ...base,
        progressPercentage: progressPct(completedUnits, totalUnits),
        lastAccessedPage: progress?.lastPage ?? 1,
        totalUnits,
        completedUnits,
      };
    }
    if (assetType === 'ELEARNING_COURSE') {
      const lessonIds = (ent.product.courseDetail?.sections ?? []).flatMap((s) => s.lessons.map((l) => l.id));
      const totalUnits = Math.max(1, lessonIds.length);
      let completedUnits = 0;
      let lastTimeSec = 0;
      let latest = 0;
      for (const lid of lessonIds) {
        const row = courseByLesson.get(lid);
        if (!row) continue;
        if (row.isCompleted) completedUnits++;
        const t = row.updatedAt instanceof Date ? row.updatedAt.getTime() : 0;
        if (t >= latest) {
          latest = t;
          lastTimeSec = row.watchedSec;
        }
      }
      return {
        ...base,
        progressPercentage: progressPct(completedUnits, totalUnits),
        lastAccessedTimeSec: lastTimeSec,
        totalUnits,
        completedUnits,
      };
    }
    // HYBRID_BUNDLE / LIVE_CLASS carry no unit progress (open to inspect contents).
    return { ...base, progressPercentage: 0, totalUnits: 1, completedUnits: 0 };
  }
}
