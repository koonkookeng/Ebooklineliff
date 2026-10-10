// SSOT Phase 112 §3.1 — Global AI content moderation contract
// Canonical: packages/shared/src/schemas/moderation.schema.ts
// - Spec-verbatim: ModerationStatusEnum (10) / FlagCategoryEnum (6) /
//   SeverityLevelEnum / ModerationCheckPayloadSchema /
//   CopyrightFingerprintSchema / CreatorAppealPayloadSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - productId/id accept min(1) edge vocabulary in addition to uuid
//     (Phase 023-031 precedent; LIFF deep-links carry short ids).
//   - Appeal status vocabulary PENDING/APPROVED/REJECTED is a const triple
//     (spec §4.1 stores a plain String — no enum migration).
// - Pure helpers: severityFor, isQuarantinedStatus, moderationQueueKey,
//   rescanRateKey, appealEligible. Budgets: 1.5s scan SLA, 0.85 flag
//   threshold, 20-row pages. Zero new deps (zod only).
import { z } from 'zod';

export const ModerationStatusEnum = z.enum([
  'PENDING_SCAN',
  'SCANNING',
  'PASSED',
  'FLAGGED_NSFW',
  'FLAGGED_COPYRIGHT',
  'FLAGGED_PROFANITY',
  'QUARANTINED',
  'APPEAL_PENDING',
  'REJECTED',
  'MANUALLY_APPROVED',
]);
export type ModerationStatus = z.infer<typeof ModerationStatusEnum>;

export const FlagCategoryEnum = z.enum([
  'COPYRIGHT_VIOLATION',
  'NUDITY_EXPLICIT',
  'VIOLENCE_GORE',
  'HATE_SPEECH_PROFANITY',
  'SCAM_FRAUD',
  'OTHER',
]);
export type FlagCategory = z.infer<typeof FlagCategoryEnum>;

export const SeverityLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type SeverityLevel = z.infer<typeof SeverityLevelEnum>;

export const ModerationContentTypeEnum = z.enum(['EBOOK', 'COURSE_VIDEO', 'PHYSICAL_COVER', 'BANNER_IMAGE']);
export type ModerationContentType = z.infer<typeof ModerationContentTypeEnum>;

export const ModerationCheckPayloadSchema = z.object({
  productId: z.string().min(1),
  contentType: ModerationContentTypeEnum,
  status: ModerationStatusEnum,
  confidenceScore: z.number().min(0).max(1),
  flaggedCategories: z.array(FlagCategoryEnum),
  violatingPagesOrTimestamps: z.array(z.string()),
  aiExplanation: z.string().optional(),
});
export type ModerationCheckPayload = z.infer<typeof ModerationCheckPayloadSchema>;

export const CopyrightFingerprintSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  perceptualHash: z.string().min(1),
  vectorEmbeddingId: z.string().min(1),
  digitalWatermarkSignature: z.string().min(1),
  createdAt: z.string(),
});
export type CopyrightFingerprint = z.infer<typeof CopyrightFingerprintSchema>;

export const CreatorAppealPayloadSchema = z.object({
  productId: z.string().min(1),
  appealReason: z.string().min(10, 'เหตุผลอุทธรณ์ต้องมีอย่างน้อย 10 ตัวอักษร').max(2000),
  proofDocumentUrls: z.array(z.string().url()),
});
export type CreatorAppealPayload = z.infer<typeof CreatorAppealPayloadSchema>;

export const ModerationReviewPayloadSchema = z.object({
  productId: z.string().min(1),
  approve: z.boolean(),
  adminNotes: z.string().min(1, 'กรุณาระบุบันทึกแอดมิน'),
});
export type ModerationReviewPayload = z.infer<typeof ModerationReviewPayloadSchema>;

/** Appeal lifecycle vocabulary (stored as plain String per §4.1). */
export const APPEAL_STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type AppealStatus = (typeof APPEAL_STATUS)[number];

/** 112 §1.3 BDD: full scan must finish within 1.5 seconds. */
export const MODERATION_SCAN_SLA_MS = 1500;
/** 112 §1.3 BDD: score above 0.85 toxicity/nudity is flagged. */
export const NSFW_FLAG_THRESHOLD = 0.85;
/** Admin studio page size. */
export const MOD_QUEUE_PAGE_SIZE = 20;
/** Rescan rate shield: 5 scans per product per 10 minutes (fail-open). */
export const MOD_RESCAN_LIMIT = 5;
export const MOD_RESCAN_WINDOW_SEC = 600;
/** Moderation event stream (Gate 8). */
export const MODERATION_EVENT_STREAM = 'stream:moderation:events';

export function moderationQueueKey(status: string, page: number): string {
  return `moderation:queue:${status}:${page}`;
}

export function rescanRateKey(productId: string): string {
  return `moderation:rescan:${productId}`;
}

/** Statuses that hide the product from the storefront. */
export function isQuarantinedStatus(status: string): boolean {
  return status === 'QUARANTINED' || status === 'FLAGGED_NSFW' || status === 'FLAGGED_COPYRIGHT' || status === 'FLAGGED_PROFANITY' || status === 'REJECTED';
}

/** Only quarantined/flagged products may enter the appeal lane. */
export function appealEligible(status: string): boolean {
  return isQuarantinedStatus(status) || status === 'APPEAL_PENDING';
}

/**
 * 112 §5.2 severity ladder: copyright match outranks NSFW (CRITICAL),
 * NSFW alone is HIGH, profanity-only is MEDIUM, clean is LOW.
 */
export function severityFor(args: { nsfwFlagged: boolean; copyrightMatched: boolean; profanityFlagged?: boolean }): SeverityLevel {
  if (args.copyrightMatched) return 'CRITICAL';
  if (args.nsfwFlagged) return 'HIGH';
  if (args.profanityFlagged === true) return 'MEDIUM';
  return 'LOW';
}
