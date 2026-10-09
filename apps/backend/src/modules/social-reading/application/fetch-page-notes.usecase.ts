// SSOT Phase 095 BDD-1 — Fetch page notes (edge-cache + privacy lattice)
// Canonical: apps/backend/src/modules/social-reading/application/fetch-page-notes.usecase.ts
// - Redis-first (60s per-page payload, BDD-1); DB refill on miss; privacy
//   lattice applied per reader (Gate 4); author overlay flagged.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { canViewNote, isAuthorNote, socialPageKey } from '@repo/shared';
import type { SocialNoteRow, SocialNoteRepository } from '../domain/social-note.repository.interface';

export interface PageCachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
}

export interface ReaderGroupsPort {
  memberGroupIds(userId: string): Promise<string[]>;
}

export interface PageNoteView {
  id: string;
  userDisplayName: string;
  isAuthorNote: boolean;
  pageNumber: number;
  positionX: number;
  positionY: number;
  content: string;
  likesCount: number;
}

@Injectable()
export class FetchPageNotesUsecase {
  constructor(
    private readonly repo: SocialNoteRepository,
    private readonly cache: PageCachePort,
    private readonly groups: ReaderGroupsPort,
  ) {}

  async execute(args: { readerUserId: string; ebookId: string; pageNumber: number }): Promise<PageNoteView[]> {
    const key = socialPageKey(args.ebookId, args.pageNumber);
    const hit = await this.cache.get(key).catch(() => null);
    let rows: SocialNoteRow[];
    if (hit) {
      try {
        rows = JSON.parse(hit) as SocialNoteRow[];
      } catch {
        rows = await this.repo.pageNotes(args.ebookId, args.pageNumber);
      }
    } else {
      rows = await this.repo.pageNotes(args.ebookId, args.pageNumber);
      await this.cache.set(key, JSON.stringify(rows), 'EX', 60).catch(() => undefined);
    }
    const groupIds = await this.groups.memberGroupIds(args.readerUserId).catch(() => []);
    return rows
      .filter((r) =>
        canViewNote(
          { visibility: r.visibility, userId: r.userId, studyGroupId: r.studyGroupId },
          { userId: args.readerUserId, groupIds, isAuthor: false },
        ),
      )
      .map((r) => ({
        id: r.id,
        userDisplayName: r.userDisplayName,
        isAuthorNote: isAuthorNote(r.visibility),
        pageNumber: r.pageNumber,
        positionX: r.positionX,
        positionY: r.positionY,
        content: r.content,
        likesCount: r.likesCount,
      }));
  }
}
