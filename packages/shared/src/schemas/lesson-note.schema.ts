// SSOT Phase 065 §3.1 — In-video lesson note contracts (verbatim)
// Canonical: packages/shared/src/schemas/lesson-note.schema.ts
// (legacy src/shared/schemas/lesson-note.schema.ts)
// - Verbatim shapes from §3.1: NoteVisibilityEnum, CreateLessonNote,
//   UpdateLessonNote, NoteSearchFilter (+ response envelopes below).
// - Budgets: DB write <100ms; content ≤5000 chars; ≤5 tags; drawer RAM
//   <30MB (scalar-only payloads); debounce 500ms; cache TTL 300s.
// - Browser-safe: pure Zod + format/key helpers. Zero new deps.
import { z } from 'zod';

export const NoteVisibilityEnum = z.enum(['PRIVATE', 'STUDY_GROUP', 'PUBLIC']);
export type NoteVisibility = z.infer<typeof NoteVisibilityEnum>;

export const CreateLessonNoteSchema = z.object({
  lessonId: z.string().uuid(),
  timestampSec: z.number().int().nonnegative(),
  content: z.string().min(1, 'เนื้อหาโน้ตต้องไม่ว่างเปล่า').max(5000, 'เนื้อหาโน้ตยาวเกินไป'),
  tags: z.array(z.string()).max(5, 'ใส่แท็กได้สูงสุด 5 แท็ก').optional(),
  visibility: NoteVisibilityEnum.default('PRIVATE'),
});
export type CreateLessonNote = z.infer<typeof CreateLessonNoteSchema>;

export const UpdateLessonNoteSchema = z.object({
  noteId: z.string().uuid(),
  content: z.string().min(1).max(5000),
  tags: z.array(z.string()).optional(),
  visibility: NoteVisibilityEnum.optional(),
});
export type UpdateLessonNote = z.infer<typeof UpdateLessonNoteSchema>;

export const NoteSearchFilterSchema = z.object({
  courseId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  keyword: z.string().optional(),
  tag: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});
export type NoteSearchFilter = z.infer<typeof NoteSearchFilterSchema>;

export const LessonNoteSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  lessonId: z.string().uuid(),
  courseId: z.string().uuid(),
  timestampSec: z.number().int().nonnegative(),
  timestampFormatted: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  visibility: NoteVisibilityEnum,
  aiSummary: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LessonNote = z.infer<typeof LessonNoteSchema>;

export const LessonNoteConnectionSchema = z.object({
  notes: z.array(LessonNoteSchema),
  totalCount: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
});
export type LessonNoteConnection = z.infer<typeof LessonNoteConnectionSchema>;

export const AiNoteSummarySchema = z.object({
  summaryText: z.string(),
  keyTakeaways: z.array(z.string()),
  suggestedActionItems: z.array(z.string()),
});
export type AiNoteSummary = z.infer<typeof AiNoteSummarySchema>;

// ---------- §5.2/§7 budgets + cache/stream keys (single source) ----------
export const NOTE_WRITE_BUDGET_MS = 100;
export const NOTE_CACHE_TTL_SEC = 300;
export const NOTE_AUTOSAVE_DEBOUNCE_MS = 500;
export const NOTE_MAX_CONTENT = 5000;
export const NOTE_MAX_TAGS = 5;
export const NOTE_STREAM_KEY = 'events:note-created';

export function noteCacheKey(userId: string, lessonId: string): string {
  return `user:${userId}:lesson:${lessonId}:notes`;
}

/** §5.2 verbatim: 225 → "03:45". */
export function formatNoteTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Gate 4: server-side XSS guard — strips script/iframe + on* handlers. */
export function sanitizeNoteContent(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .slice(0, NOTE_MAX_CONTENT);
}
