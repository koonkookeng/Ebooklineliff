// SSOT Phase 095 §5.1 — Social note repository port (DB-free tests)
// Canonical: apps/backend/src/modules/social-reading/domain/social-note.repository.interface.ts
// - Zero new deps.
export interface SocialNoteRow {
  id: string;
  ebookId: string;
  userId: string;
  userDisplayName: string;
  userAvatarUrl: string | null;
  pageNumber: number;
  positionX: number;
  positionY: number;
  selectedText: string | null;
  content: string;
  visibility: string;
  noteType: string;
  studyGroupId: string | null;
  likesCount: number;
  createdAt: Date;
}

export interface SocialNoteRepository {
  createNote(args: {
    ebookId: string;
    userId: string;
    pageNumber: number;
    positionX: number;
    positionY: number;
    selectedText?: string;
    content: string;
    visibility: string;
    noteType: string;
    studyGroupId?: string;
  }): Promise<SocialNoteRow>;
  pageNotes(ebookId: string, pageNumber: number): Promise<SocialNoteRow[]>;
  toggleLike(noteId: string, userId: string): Promise<{ liked: boolean; likesCount: number }>;
  memberGroupIds(userId: string): Promise<string[]>;
  withTx?(tx: unknown): SocialNoteRepository;
}
