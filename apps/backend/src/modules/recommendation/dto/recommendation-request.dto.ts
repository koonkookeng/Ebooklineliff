// SSOT Phase 104 §3.1 — Recommendation request DTOs (Zod-backed, code-first GQL aligned)
// Canonical: apps/backend/src/modules/recommendation/dto/recommendation-request.dto.ts
// - Re-exports SSOT schemas + narrows DTO shapes. Zero new deps.
import {
  TrackInteractionEventSchema,
  RecommendationItemSchema,
  RecommendationSlatePayloadSchema,
  type RecommendationItem,
  type TrackInteractionEvent,
} from '@repo/shared';

export { TrackInteractionEventSchema, RecommendationItemSchema, RecommendationSlatePayloadSchema };
export type { RecommendationItem, TrackInteractionEvent };

export interface SlateQuery {
  limit: number;
}

export function parseSlateLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : 6;
  if (!Number.isFinite(n)) return 6;
  return Math.min(20, Math.max(1, Math.floor(n)));
}
