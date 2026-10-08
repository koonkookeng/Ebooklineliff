// SSOT Phase 054 §3.1 — progress-sync DTOs (Zod-derived, no duplicated shapes)
// Canonical: apps/backend/src/modules/stream/dto/sync-progress.dto.ts
// (legacy src/backend/modules/stream/dto/sync-progress.dto.ts)
// - Decorator-free on purpose: pure helpers stay tsx-importable for contract
//   tests (Phase 027–054 precedent); resolvers carry Nest param decorators
//   and are verified via static parity.
// - SyncLessonProgressInput is the LIFF-facing shape (§3.1); toSyncProgress
//   adapts it to the Phase 045 SyncLessonProgress transport (adds the
//   server-known durationSec) without redefining the schema.
import {
  SyncLessonProgressInputSchema,
  SyncLessonProgressSchema,
  type SyncLessonProgress,
  type SyncLessonProgressInput,
} from '@repo/shared';

export { SyncLessonProgressInputSchema };
export type { SyncLessonProgressInput };

/** Adapt the LIFF input (§3.1) to the write-behind transport (Phase 045). */
export function toSyncProgress(input: SyncLessonProgressInput, durationSec: number): SyncLessonProgress {
  return SyncLessonProgressSchema.parse({
    lessonId: input.lessonId,
    watchedSec: input.watchedSec,
    durationSec,
    isCompleted: input.isCompleted,
  });
}
