// SSOT Phase 026 §3.1 — Native share target picker + viral attribution Zod contract
// Canonical: packages/shared/src/schemas/social-share.schema.ts
// (spec §3.1 lives under src/shared/schemas/sdid-contract.ts; canonical maps to
// packages/shared/src per filefolder.md; dedicated file per zero-redundant policy)
// - RISK_CALL deviations (documented, additive-only):
//   - productId/targetLessonId are z.string().min(1), not uuid: ids flow as opaque
//     strings at the edge (Phase 023/024/025 precedent); uuid strictness 400s valid links.
//   - FlexMessagePayloadSchema.contents is z.record(z.unknown()): LINE bubble/
//     carousel JSON is schema-external; depth/size guarded in the builder service.
// - Zero new deps (zod only).
import { z } from 'zod';

export const ShareTargetTypeEnum = z.enum(['INDIVIDUAL', 'GROUP', 'ROOM', 'EXTERNAL_URL']);
export type ShareTargetType = z.infer<typeof ShareTargetTypeEnum>;

export const ShareStatusEnum = z.enum(['SUCCESS', 'CANCELLED', 'FAILED']);
export type ShareStatus = z.infer<typeof ShareStatusEnum>;

export const ShareContentTypeEnum = z.enum([
  'EBOOK_PAGE',
  'EBOOK_SUMMARY',
  'COURSE_LESSON',
  'CERTIFICATE',
  'PRODUCT_BUNDLE',
]);
export type ShareContentType = z.infer<typeof ShareContentTypeEnum>;

export const DynamicFlexShareInputSchema = z.object({
  productId: z.string().min(1),
  contentType: ShareContentTypeEnum,
  targetPageNumber: z.number().int().positive().optional(),
  targetLessonId: z.string().min(1).optional(),
  customQuote: z.string().max(100).optional(),
});
export type DynamicFlexShareInput = z.infer<typeof DynamicFlexShareInputSchema>;

export const FlexMessagePayloadSchema = z.object({
  type: z.literal('flex'),
  altText: z.string().min(1).max(400),
  contents: z.record(z.unknown()),
});
export type FlexMessagePayload = z.infer<typeof FlexMessagePayloadSchema>;

export const RecordShareLogInputSchema = z.object({
  productId: z.string().min(1),
  targetType: ShareTargetTypeEnum,
  status: ShareStatusEnum,
  shareToken: z.string().min(1).max(64),
});
export type RecordShareLogInput = z.infer<typeof RecordShareLogInputSchema>;

export const ShareTargetPickerResultSchema = z.object({
  success: z.boolean(),
  shareLogId: z.string().uuid().optional(),
  rewardPointsEarned: z.number().int().nonnegative().default(0),
  message: z.string(),
});
export type ShareTargetPickerResult = z.infer<typeof ShareTargetPickerResultSchema>;

export const GenerateFlexShareResponseSchema = z.object({
  flexMessageJson: z.string().min(1),
  shareToken: z.string().min(1),
  affiliateCode: z.string().min(1),
  deepLinkUrl: z.string().min(1),
});
export type GenerateFlexShareResponse = z.infer<typeof GenerateFlexShareResponseSchema>;

/** Viral share reward (points credited on SUCCESS, §5.2). */
export const SHARE_REWARD_POINTS = 5;
/** Referral binding window for viral conversion (BDD Scenario 2: 30 days). */
export const REFERRAL_BIND_DAYS = 30;
/** Preview gate: shared links serve encrypted chunks for pages 1–10 only (§8.1). */
export const SHARE_PREVIEW_MAX_PAGE = 10;
