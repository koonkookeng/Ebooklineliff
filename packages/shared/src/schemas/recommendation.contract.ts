// SSOT Phase 104 §3.1 — Recommendation Zod domain contract
// Canonical: packages/shared/src/schemas/recommendation.contract.ts
// - Spec-verbatim: RecommendationReasonTypeEnum / RecommendationAlgorithmEnum /
//   TrackInteractionEventSchema / RecommendationItemSchema /
//   RecommendationSlatePayloadSchema (§3.1).
// - Pure helpers: slate cache key, event stream key, budgets. Zod only.
import { z } from 'zod';

export const RecommendationReasonTypeEnum = z.enum([
  'BASED_ON_READING_HISTORY',
  'BASED_ON_COURSE_COMPLETION',
  'VECTOR_SIMILARITY_MATCH',
  'COLLABORATIVE_USER_ALSO_BOUGHT',
  'TRENDING_IN_CATEGORY',
  'COLD_START_ONBOARDING',
]);
export type RecommendationReasonType = z.infer<typeof RecommendationReasonTypeEnum>;

export const RecommendationAlgorithmEnum = z.enum([
  'PGVECTOR_COSINE_SEMANTIC',
  'COLLABORATIVE_FILTERING_CF',
  'BEHAVIORAL_HEURISTIC',
  'HYBRID_RERANKED',
]);
export type RecommendationAlgorithm = z.infer<typeof RecommendationAlgorithmEnum>;

export const InteractionEventTypeEnum = z.enum([
  'ITEM_VIEW',
  'READING_DWELL_TIME',
  'VIDEO_WATCH_PROGRESS',
  'ADD_TO_CART',
  'PURCHASE_COMPLETED',
  'FLEX_SHARE_CLICK',
]);
export type InteractionEventType = z.infer<typeof InteractionEventTypeEnum>;

export const TrackInteractionEventSchema = z.object({
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  eventType: InteractionEventTypeEnum,
  dwellTimeSec: z.number().int().nonnegative().optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  timestamp: z.string().datetime(),
});
export type TrackInteractionEvent = z.infer<typeof TrackInteractionEventSchema>;

export const RecommendationItemSchema = z.object({
  productId: z.string().uuid(),
  title: z.string(),
  coverImageUrl: z.string().url(),
  productType: z.enum(['PHYSICAL_BOOK', 'EBOOK', 'ELEARNING_COURSE', 'LIVE_CLASS', 'HYBRID_BUNDLE']),
  price: z.number().positive(),
  discountPrice: z.number().positive().nullable(),
  matchScore: z.number().min(0).max(100),
  reasonType: RecommendationReasonTypeEnum,
  reasonText: z.string(),
  algorithmUsed: RecommendationAlgorithmEnum,
});
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;

export const RecommendationSlatePayloadSchema = z.object({
  tenantId: z.string(),
  userId: z.string().uuid(),
  slateTitle: z.string(),
  items: z.array(RecommendationItemSchema),
  generatedAt: z.string().datetime(),
});
export type RecommendationSlatePayload = z.infer<typeof RecommendationSlatePayloadSchema>;

/** Cold-start gate: < 3 interactions → curated bestsellers (BDD §1.3). */
export const COLD_START_INTERACTION_THRESHOLD = 3;

/** Slate edge-cache TTL (15 min, §5.2). */
export const SLATE_TTL_SEC = 900;

/** slate default size (BDD top-5 + 1 spare for purge discipline). */
export const SLATE_DEFAULT_LIMIT = 6;

/** Recommendation latency budget: < 150ms p95 (BUSINESS_GOAL). */
export const REC_LATENCY_BUDGET_MS = 150;

/** Recommendation UI RAM overhead: < 15MB (§2.1 LIFF constraints). */
export const REC_RAM_BUDGET_MB = 15;

/** Recommendation embedding dims: 768 (Product.embedding vector(768)). */
export const REC_EMBEDDING_DIMS = 768;

/** GraphQL/REST rate limit: 30 req/min/user (§8.1 anti-scrape). */
export const REC_RATE_LIMIT_PER_MIN = 30;

/** Redis key for a user's cached slate (edge, zero-egress §8.2). */
export function recSlateCacheKey(tenantId: string, userId: string): string {
  return `rec:slate:${tenantId}:${userId}`;
}

/** Redis stream for real-time interaction events (§7.1 pipeline). */
export function recEventStreamKey(): string {
  return 'stream:user-events';
}

/** Redis key for per-user slate rate limiting (§8.1). */
export function recRateLimitKey(userId: string): string {
  return `ratelimit:rec:${userId}`;
}
