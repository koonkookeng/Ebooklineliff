// SSOT Phase 110 §5.1 — Inspector query DTOs (REST coercion layer)
// Canonical: apps/backend/src/modules/user-inspector/dto/user-360-query.dto.ts
// - Canonical Zod lives in @repo/shared (inspector-contract.ts); this file
//   only coerces REST query strings (Zero Redundant Code).
// - Zero new deps.
import { z } from 'zod';
import { RiskLevelEnum, UserActivityTypeEnum, INSPECTOR_RECENT_LIMIT } from '@repo/shared';

export { RiskLevelEnum, UserActivityTypeEnum };

export const HeatmapQuerySchema = z.object({
  userId: z.string().min(1),
  ebookId: z.string().min(1),
});
export type HeatmapQuery = z.infer<typeof HeatmapQuerySchema>;

export const VideoAnalyticsQuerySchema = z.object({
  userId: z.string().min(1),
  courseId: z.string().min(1),
});
export type VideoAnalyticsQuery = z.infer<typeof VideoAnalyticsQuerySchema>;

export const SecurityLogsQuerySchema = z.object({
  userId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type SecurityLogsQuery = z.infer<typeof SecurityLogsQuerySchema>;

export const ReadingBatchItemSchema = z.object({
  userId: z.string().min(1),
  ebookId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  dwellTimeSeconds: z.number().int().nonnegative().default(0),
  sessionToken: z.string().optional(),
});
export const ReadingBatchSchema = z.array(ReadingBatchItemSchema).max(500);
export type ReadingBatch = z.infer<typeof ReadingBatchSchema>;

export const VideoBatchItemSchema = z.object({
  userId: z.string().min(1),
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  watchedSec: z.number().int().nonnegative(),
  maxPositionSec: z.number().int().nonnegative().default(0),
  isCompleted: z.boolean().default(false),
});
export const VideoBatchSchema = z.array(VideoBatchItemSchema).max(500);
export type VideoBatch = z.infer<typeof VideoBatchSchema>;

export { INSPECTOR_RECENT_LIMIT };
