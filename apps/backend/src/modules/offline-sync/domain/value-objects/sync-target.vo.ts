// SSOT Phase 062 §5.1 — SyncTarget VO (target taxonomy + payload gates)
// Canonical: apps/backend/src/modules/offline-sync/domain/value-objects/sync-target.vo.ts
// - Pure, tsx-safe. Classifies queue items and validates per-target payloads:
//   EBOOK_PROGRESS {ebookId,lastPage}, COURSE_PROGRESS {lessonId,watchedSec},
//   OFFLINE_ANALYTICS {event,...}. Unknown targets → invalid (failedIds).
// - Zero new deps.
import { SyncTargetTypeEnum, type SyncTargetType } from '@repo/shared';

export function parseSyncTarget(input: unknown): SyncTargetType | null {
  const parsed = SyncTargetTypeEnum.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface EbookProgressPayload {
  ebookId: string;
  lastPage: number;
}

export interface CourseProgressPayload {
  lessonId: string;
  watchedSec: number;
  isCompleted?: boolean;
}

export function asEbookProgress(payload: Record<string, unknown>): EbookProgressPayload | null {
  const { ebookId, lastPage } = payload;
  if (typeof ebookId !== 'string' || ebookId.length === 0) return null;
  if (!Number.isInteger(lastPage) || (lastPage as number) < 1) return null;
  return { ebookId, lastPage: lastPage as number };
}

export function asCourseProgress(payload: Record<string, unknown>): CourseProgressPayload | null {
  const { lessonId, watchedSec, isCompleted } = payload;
  if (typeof lessonId !== 'string' || lessonId.length === 0) return null;
  if (!Number.isInteger(watchedSec) || (watchedSec as number) < 0) return null;
  return { lessonId, watchedSec: watchedSec as number, isCompleted: isCompleted === true };
}
