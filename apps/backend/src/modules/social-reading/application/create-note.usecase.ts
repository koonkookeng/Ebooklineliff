// SSOT Phase 095 BDD-2 — Create note usecase (atomic + edge publish + Flex)
// Canonical: apps/backend/src/modules/social-reading/application/create-note.usecase.ts
// - Zod gate → entity guards → atomic row (Gate 7) → cache invalidate +
//   density/share stream (Gate 8) → Flex share payload (Task 7).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateMarginNoteSchema, SOCIAL_STREAM, isAuthorNote, socialPageKey } from '@repo/shared';
import { assertNoteCreatable } from '../domain/social-note.entity';
import type { SocialNoteRepository } from '../domain/social-note.repository.interface';
import { buildSocialNoteFlex } from '../infrastructure/line/social-note-flex.builder';

export interface SocialBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface SocialCachePort {
  del(...keys: string[]): Promise<void>;
}

@Injectable()
export class CreateNoteUsecase {
  constructor(
    private readonly repo: SocialNoteRepository,
    private readonly cache: SocialCachePort,
    private readonly bus: SocialBus,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async execute(args: {
    userId: string;
    userDisplayName: string;
    input: {
      ebookId: string; pageNumber: number; positionX: number; positionY: number;
      selectedText?: string; content: string; visibility: string; noteType: string;
      studyGroupId?: string;
    };
  }): Promise<{ noteId: string; flexMessageJson: string }> {
    const parsed = CreateMarginNoteSchema.safeParse(args.input);
    if (!parsed.success) throw new BadRequestException('Invalid margin note');
    assertNoteCreatable(parsed.data);
    const row = await this.repo.createNote({ ...parsed.data, userId: args.userId });
    await this.cache.del(socialPageKey(row.ebookId, row.pageNumber)).catch(() => undefined);
    await this.bus
      .xadd(SOCIAL_STREAM, {
        event: 'margin_note_created',
        noteId: row.id,
        ebookId: row.ebookId,
        pageNumber: row.pageNumber,
        visibility: row.visibility,
        at: Date.now(),
      })
      .catch(() => undefined);
    const flexMessageJson = JSON.stringify(
      buildSocialNoteFlex({
        content: row.content,
        pageNumber: row.pageNumber,
        authorName: isAuthorNote(row.visibility) ? `✦ ${args.userDisplayName} (ผู้เขียน)` : args.userDisplayName,
        readerUrl: `${this.origin.replace(/\/$/, '')}/reader/${row.ebookId}?page=${row.pageNumber}`,
      }),
    );
    return { noteId: row.id, flexMessageJson };
  }
}
