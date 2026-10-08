// SSOT Phase 078 §3.1 — E-Learning Studio Zod contract
// Canonical: packages/shared/src/schemas/course-studio-contract.ts
// (legacy src/shared/schemas/course-studio-contract.ts)
// - Spec §3.1 shapes, renamed with Studio* prefix: Phase 047 already owns
//   QuizOptionSchema/LessonQuiz-shaped names in the barrel (050/071 alias
//   precedent) — Studio* aliases avoid the collision, zero behavior change.
// - RISK_CALL deviations (additive-only, documented):
//   (a) no @hello-pangea/dnd (§6.1 asks it): studio DnD rides native HTML5
//       drag-and-drop (zero-dep, 60fps, <45MB) — same reorder payload;
//   (b) tenantId is z.string().min(1) (x-tenant-identifier slug hint,
//       Phase 071/073 runtime vocabulary).
// - Pure helpers: reorder normalization, HLS object keys, quiz grading.
//   Zero new deps (zod only).
import { z } from 'zod';

export const StudioQuizOptionSchema = z.object({
  id: z.string().uuid(),
  optionText: z.string().min(1, 'Option text cannot be empty'),
  isCorrect: z.boolean(),
});
export type StudioQuizOption = z.infer<typeof StudioQuizOptionSchema>;

export const StudioLessonQuizSchema = z.object({
  id: z.string().uuid().optional(),
  lessonId: z.string().uuid(),
  question: z.string().min(3, 'Question must be at least 3 characters'),
  explanation: z.string().optional(),
  points: z.number().int().positive().default(10),
  options: z.array(StudioQuizOptionSchema).min(2, 'At least 2 options required'),
});
export type StudioLessonQuiz = z.infer<typeof StudioLessonQuizSchema>;

export const StudioReorderLessonItemSchema = z.object({
  lessonId: z.string().uuid(),
  lessonOrder: z.number().int().nonnegative(),
});
export type StudioReorderLessonItem = z.infer<typeof StudioReorderLessonItemSchema>;

export const StudioReorderSectionSchema = z.object({
  sectionId: z.string().uuid(),
  sectionOrder: z.number().int().nonnegative(),
  lessons: z.array(StudioReorderLessonItemSchema),
});
export type StudioReorderSection = z.infer<typeof StudioReorderSectionSchema>;

export const StudioCurriculumReorderPayloadSchema = z.object({
  tenantId: z.string().min(1),
  courseId: z.string().uuid(),
  sections: z.array(StudioReorderSectionSchema),
});
export type StudioCurriculumReorderPayload = z.infer<typeof StudioCurriculumReorderPayloadSchema>;

export const StudioHlsUploadPresignSchema = z.object({
  tenantId: z.string().min(1),
  lessonId: z.string().uuid(),
  fileName: z.string(),
  fileSizeBytes: z.number().positive(),
  contentType: z.string().refine((val) => ['video/mp4', 'video/quicktime', 'video/x-matroska'].includes(val), {
    message: 'Invalid video format. Only MP4, MOV, and MKV allowed.',
  }),
});
export type StudioHlsUploadPresign = z.infer<typeof StudioHlsUploadPresignSchema>;

export const StudioHlsWebhookSchema = z.object({
  lessonId: z.string().uuid(),
  status: z.enum(['COMPLETED', 'FAILED']),
  videoHlsUrl: z.string().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
  signature: z.string(),
  timestamp: z.number(),
});
export type StudioHlsWebhook = z.infer<typeof StudioHlsWebhookSchema>;

/** Curriculum structure cache key (BDD-1 invalidate). */
export function studioStructureKey(courseId: string): string {
  return `cache:course:structure:${courseId}`;
}
/** R2 raw upload key for a lesson source video (§8.1 direct upload). */
export function studioRawVideoKey(tenantId: string, lessonId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `tenants/${tenantId}/studio/raw/${lessonId}/${Date.now()}-${safe}`;
}
/** Presigned upload TTL: 15 minutes. */
export const STUDIO_PRESIGN_TTL_SEC = 900;
/** Reorder SLA: persist < 100ms perception (optimistic + atomic). */
export const REORDER_BUDGET_MS = 100;
/** Studio event stream (§7.1). */
export const STUDIO_EVENT_STREAM = 'studio:events';

/** Normalize a reorder payload: sort + reindex 0..n (idempotent). */
export function normalizeReorder(
  sections: Array<{ sectionId: string; lessons: Array<{ lessonId: string }> }>,
): Array<{ sectionId: string; sectionOrder: number; lessons: Array<{ lessonId: string; lessonOrder: number }> }> {
  return sections.map((s, si) => ({
    sectionId: s.sectionId,
    sectionOrder: si,
    lessons: s.lessons.map((l, li) => ({ lessonId: l.lessonId, lessonOrder: li })),
  }));
}

/** Grade a single-choice submission (auto-grading, BDD-3). */
export function gradeStudioQuiz(
  options: Array<{ id: string; isCorrect: boolean }>,
  selectedOptionId: string,
  points: number,
): { isPassed: boolean; scoreEarned: number } {
  const hit = options.find((o) => o.id === selectedOptionId);
  const passed = hit?.isCorrect === true;
  return { isPassed: passed, scoreEarned: passed ? points : 0 };
}
