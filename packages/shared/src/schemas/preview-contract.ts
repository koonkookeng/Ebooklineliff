// SSOT Phase 051 §3.1 — preview content limit contracts (10 pages / 120s gatekeeper)
// Canonical: packages/shared/src/schemas/preview-contract.ts
// (legacy src/shared/schemas/preview-contract.ts)
// - Verbatim shapes from §3.1 (+ budgets/helpers shared by backend edge + LIFF UI).
// - Budgets: EBOOK 10 pages (seller-overridable via EbookDetail.previewPages),
//   VIDEO 120s (via CourseLesson.previewLimitSec), preview HLS token TTL 60s,
//   LIFF RAM < 30MB, analytics tick 5s.
import { z } from 'zod';

export const PreviewContentTypeEnum = z.enum(['EBOOK', 'ELEARNING_LESSON']);
export type PreviewContentType = z.infer<typeof PreviewContentTypeEnum>;

export const PreviewAccessCheckSchema = z.object({
  productId: z.string().uuid(),
  contentType: PreviewContentTypeEnum,
  targetPage: z.number().int().positive().optional(),
  currentTimestampSec: z.number().nonnegative().optional(),
});
export type PreviewAccessCheck = z.infer<typeof PreviewAccessCheckSchema>;

export const EbookPreviewChunkPayloadSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  totalPreviewPages: z.number().int().positive(),
  isLastPreviewPage: z.boolean(),
  vectorSvgContent: z.string(),
  forensicWatermarkData: z.object({
    watermarkText: z.string(),
    userIdHash: z.string(),
    timestamp: z.string(),
  }),
  hasEntitlement: z.boolean(),
});
export type EbookPreviewChunkPayload = z.infer<typeof EbookPreviewChunkPayloadSchema>;

export const VideoPreviewStreamPayloadSchema = z.object({
  lessonId: z.string().uuid(),
  hlsPreviewPlaylistUrl: z.string().url(),
  maxAllowedSeconds: z.number().int().default(120),
  previewToken: z.string(),
  hasEntitlement: z.boolean(),
});
export type VideoPreviewStreamPayload = z.infer<typeof VideoPreviewStreamPayloadSchema>;

export const PaywallTriggerPayloadSchema = z.object({
  productId: z.string().uuid(),
  productTitle: z.string(),
  coverImageUrl: z.string().url(),
  price: z.number(),
  discountPrice: z.number().nullable(),
  previewLimitType: PreviewContentTypeEnum,
  reachedLimitValue: z.string(),
  promptPayQrPayload: z.string(),
});
export type PaywallTriggerPayload = z.infer<typeof PaywallTriggerPayloadSchema>;

export const PreviewEventInputSchema = z.object({
  productId: z.string().uuid(),
  contentType: PreviewContentTypeEnum,
  reachedValue: z.number().int().nonnegative(),
  action: z.enum(['PAGE_VIEW', 'VIDEO_TICK', 'PAYWALL_TRIGGER']),
  lineUserId: z.string().optional(),
});
export type PreviewEventInput = z.infer<typeof PreviewEventInputSchema>;

// ---------- §4.1/§8.1 budgets + helpers (single source; backend + edge share these) ----------
export const PREVIEW_EBOOK_DEFAULT_PAGES = 10;
export const PREVIEW_VIDEO_DEFAULT_SEC = 120;
export const PREVIEW_HLS_TOKEN_TTL_SEC = 60;
export const PREVIEW_ANALYTICS_TICK_SEC = 5;
export const PREVIEW_LIFF_RAM_BUDGET_MB = 30;

export function previewChunkKey(productId: string, pageNumber: number): string {
  return `preview:ebook:${productId}:${pageNumber}`;
}

export function previewUsageId(contentType: string, identity: string, productId: string): string {
  return `${contentType}:${identity}:${productId}`;
}

/** Strict server-edge boundary: page N allowed iff N ≤ maxPreviewPages. */
export function isEbookPageAllowed(targetPage: number, maxPreviewPages: number): boolean {
  return Number.isInteger(targetPage) && targetPage >= 1 && targetPage <= maxPreviewPages;
}

/** Strict server-edge boundary: playback second S allowed iff S < maxAllowedSec. */
export function isVideoSecondAllowed(currentSec: number, maxAllowedSec: number): boolean {
  return currentSec >= 0 && currentSec < maxAllowedSec;
}

export function previewLimitMessage(contentType: PreviewContentType, limit: number): string {
  return contentType === 'EBOOK'
    ? `คุณอ่านตัวอย่างฟรีครบ ${limit} หน้าแล้ว กรุณาสั่งซื้อเพื่ออ่านต่อทั้งเล่ม`
    : `คุณชมวิดีโอตัวอย่างฟรีครบ ${Math.floor(limit / 60)} นาทีแล้ว กรุณาสมัครเรียนเพื่อดูต่อ`;
}

/** Remaining quota banner (§2.2 PREVIEW_ACTIVE), e.g. "ทดลองอ่าน หน้า 8/10". */
export function remainingQuotaLabel(
  contentType: PreviewContentType,
  consumed: number,
  limit: number,
): string {
  return contentType === 'EBOOK'
    ? `ทดลองอ่าน หน้า ${Math.min(consumed, limit)}/${limit}`
    : `ทดลองชมฟรี: ${Math.max(0, limit - consumed)} วินาทีที่เหลือ`;
}
