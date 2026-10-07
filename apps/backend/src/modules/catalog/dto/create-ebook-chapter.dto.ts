// SSOT Phase 037 Task 3 — Create chapter DTO (Zod SSOT re-export)
// Canonical: apps/backend/src/modules/catalog/dto/create-ebook-chapter.dto.ts
// (legacy src/backend/modules/catalog/dto/create-ebook-chapter.dto.ts)
// - Ordering is server-assigned (chapterIndex = max + 1); never client-asserted.
import { CreateEbookChapterSchema } from '@repo/shared';
import type { CreateEbookChapter } from '@repo/shared';

export { CreateEbookChapterSchema };
export type CreateEbookChapterDto = CreateEbookChapter;
