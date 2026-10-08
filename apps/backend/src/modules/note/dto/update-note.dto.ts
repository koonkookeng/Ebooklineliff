// SSOT Phase 065 §5.1 — Update-note DTO (Zod-gated transport surface)
// Canonical: apps/backend/src/modules/note/dto/update-note.dto.ts
// (legacy src/backend/modules/note/dto/update-note.dto.ts)
// - Re-exports the Zod SSOT; boundary safeParse in service/resolver.
// - Zero new deps.
import { UpdateLessonNoteSchema, NoteSearchFilterSchema } from '@repo/shared';

export { UpdateLessonNoteSchema, NoteSearchFilterSchema };
export type { UpdateLessonNote, NoteSearchFilter } from '@repo/shared';
