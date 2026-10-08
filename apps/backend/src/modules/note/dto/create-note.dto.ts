// SSOT Phase 065 §5.1 — Create-note DTO (Zod-gated transport surface)
// Canonical: apps/backend/src/modules/note/dto/create-note.dto.ts
// (legacy src/backend/modules/note/dto/create-note.dto.ts)
// - Re-exports the Zod SSOT; boundary safeParse in service/resolver.
// - Zero new deps.
import { CreateLessonNoteSchema } from '@repo/shared';

export { CreateLessonNoteSchema };
export type { CreateLessonNote } from '@repo/shared';
