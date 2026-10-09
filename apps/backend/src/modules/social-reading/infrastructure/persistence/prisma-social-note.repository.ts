// SSOT Phase 095 §5.1 — Prisma social note repository (structural adapter)
// Canonical: apps/backend/src/modules/social-reading/infrastructure/persistence/prisma-social-note.repository.ts
// - Like toggles + counters run inside caller-owned $transactions (Gate 7);
//   this adapter only shapes rows. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type { SocialNoteRepository, SocialNoteRow } from '../../domain/social-note.repository.interface';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function mapNote(
  r: Record<string, unknown> & { user?: { displayName: string; avatarUrl: string | null } },
): SocialNoteRow {
  return {
    id: String(r['id']),
    ebookId: String(r['ebookId']),
    userId: String(r['userId']),
    userDisplayName: r.user?.displayName ?? 'นักอ่าน',
    userAvatarUrl: r.user?.avatarUrl ?? null,
    pageNumber: Number(r['pageNumber']),
    positionX: Number(r['positionX']),
    positionY: Number(r['positionY']),
    selectedText: (r['selectedText'] as string | null) ?? null,
    content: String(r['content']),
    visibility: String(r['visibility']),
    noteType: String(r['noteType']),
    studyGroupId: (r['studyGroupId'] as string | null) ?? null,
    likesCount: Number(r['likesCount']),
    createdAt: r['createdAt'] as Date,
  };
}

function toRepo(db: Db): SocialNoteRepository {
  const notes = db['socialNote'];
  const reactions = db['socialNoteReaction'];
  const groups = db['studyGroup'];
  return {
    async createNote(args) {
      const row = (await notes.create({
        data: { ...args },
        include: { user: true },
      })) as unknown as Record<string, unknown> & { user?: { displayName: string; avatarUrl: string | null } };
      return mapNote(row);
    },

    async pageNotes(ebookId: string, pageNumber: number): Promise<SocialNoteRow[]> {
      const rows = (await notes
        .findMany({ where: { ebookId, pageNumber }, include: { user: true }, orderBy: { createdAt: 'asc' }, take: 100 })
        .catch(() => [])) as unknown as Array<Record<string, unknown> & { user?: { displayName: string; avatarUrl: string | null } }>;
      return (rows as Array<Record<string, unknown> & { user?: { displayName: string; avatarUrl: string | null } }>).map(mapNote);
    },

    async toggleLike(noteId: string, userId: string): Promise<{ liked: boolean; likesCount: number }> {
      const existing = (await reactions
        .findUnique({ where: { noteId_userId: { noteId, userId } } })
        .catch(() => null)) as unknown as { id: string } | null;
      if (existing) {
        await reactions.delete({ where: { noteId_userId: { noteId, userId } } });
        const row = (await notes.update({
          where: { id: noteId },
          data: { likesCount: { decrement: 1 } },
        })) as unknown as { likesCount: number };
        return { liked: false, likesCount: Math.max(0, row.likesCount) };
      }
      await reactions.create({ data: { noteId, userId, type: 'LIKE' } });
      const row = (await notes.update({
        where: { id: noteId },
        data: { likesCount: { increment: 1 } },
      })) as unknown as { likesCount: number };
      return { liked: true, likesCount: row.likesCount };
    },

    async memberGroupIds(userId: string): Promise<string[]> {
      const rows = (await groups
        .findMany({ where: { OR: [{ ownerId: userId }, { memberIds: { has: userId } }] }, select: { id: true } })
        .catch(() => [])) as unknown as Array<{ id: string }>;
      return (rows as Array<{ id: string }>).map((r) => r.id);
    },
  };
}

@Injectable()
export class PrismaSocialNoteRepository implements SocialNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): SocialNoteRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): SocialNoteRepository {
    return toRepo(tx as Db);
  }

  createNote(args: {
    ebookId: string; userId: string; pageNumber: number; positionX: number; positionY: number;
    selectedText?: string; content: string; visibility: string; noteType: string; studyGroupId?: string;
  }) { return this.root.createNote(args); }
  pageNotes(ebookId: string, pageNumber: number) { return this.root.pageNotes(ebookId, pageNumber); }
  toggleLike(noteId: string, userId: string) { return this.root.toggleLike(noteId, userId); }
  memberGroupIds(userId: string) { return this.root.memberGroupIds(userId); }
}
