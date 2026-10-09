// SSOT Phase 095 §3.1 — Social reading Zod domain contract
// Canonical: packages/shared/src/schemas/social-reading.schema.ts
// (legacy src/shared/schemas/social-reading.schema.ts — placeholder until now)
// - Spec-verbatim: NoteVisibilityEnum / NoteTypeEnum /
//   CreateMarginNoteSchema / MarginNotePayloadSchema (§3.1).
// - RISK_CALL (documented): visibility lattice PRIVATE < STUDY_GROUP <
//   FRIENDS < PUBLIC, AUTHOR_OFFICIAL = verified overlay (any reader).
//   FRIENDS = mutual-share readers (simplified: same-tenant readers who
//   share at least one group with the author — enforced server-side).
// - Pure helpers: visibility gate, pin color, page cache key, like toggle,
//   stream keys. Zero new deps (zod only).
import { z } from 'zod';

export const NoteVisibilityEnum = z.enum([
  'PRIVATE',
  'FRIENDS',
  'STUDY_GROUP',
  'PUBLIC',
  'AUTHOR_OFFICIAL',
]);
export type NoteVisibility = z.infer<typeof NoteVisibilityEnum>;

export const NoteTypeEnum = z.enum([
  'MARGIN_TEXT',
  'TEXT_HIGHLIGHT',
  'VOICE_SNIPPET',
  'QUESTION_THREAD',
]);
export type NoteType = z.infer<typeof NoteTypeEnum>;

export const CreateMarginNoteSchema = z.object({
  ebookId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  selectedText: z.string().optional(),
  content: z.string().min(1).max(1000),
  visibility: NoteVisibilityEnum,
  noteType: NoteTypeEnum,
  studyGroupId: z.string().uuid().optional(),
});
export type CreateMarginNote = z.infer<typeof CreateMarginNoteSchema>;

export const MarginNotePayloadSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  userDisplayName: z.string(),
  userAvatarUrl: z.string().nullable(),
  isAuthorNote: z.boolean(),
  pageNumber: z.number().int().positive(),
  positionX: z.number(),
  positionY: z.number(),
  selectedText: z.string().nullable(),
  content: z.string(),
  likesCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type MarginNotePayload = z.infer<typeof MarginNotePayloadSchema>;

/** Social note event stream (Gate 8: density + viral share). */
export const SOCIAL_STREAM = 'stream:social:notes';

/** Page-anchored edge-cache key (60s TTL, BDD-1). */
export function socialPageKey(ebookId: string, pageNumber: number): string {
  return `social:page:${ebookId}:${pageNumber}`;
}

/** Pin color: gold for author, LINE green for members. */
export function notePinColor(isAuthorNote: boolean): string {
  return isAuthorNote ? '#FFD700' : '#00C300';
}

/** Visibility gate for a reader (server-side, Gate 4). */
export function canViewNote(
  note: { visibility: string; userId: string; studyGroupId: string | null },
  reader: { userId: string; groupIds: string[]; isAuthor: boolean },
): boolean {
  if (note.userId === reader.userId) return true;
  switch (note.visibility) {
    case 'PUBLIC':
    case 'AUTHOR_OFFICIAL':
      return true;
    case 'STUDY_GROUP':
      return note.studyGroupId != null && reader.groupIds.includes(note.studyGroupId);
    case 'FRIENDS':
      return reader.groupIds.length > 0;
    default:
      return false;
  }
}

/** Author overlay flag: AUTHOR_OFFICIAL visibility marks verified notes. */
export function isAuthorNote(visibility: string): boolean {
  return visibility === 'AUTHOR_OFFICIAL';
}
