// SSOT Phase 095 — Toggle like usecase (idempotent, atomic counter)
// Canonical: apps/backend/src/modules/social-reading/application/toggle-like-note.usecase.ts
// - @@unique(noteId, userId) makes the toggle idempotent; counter moves in
//   the same transaction (Gate 7). Port-based tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { SOCIAL_STREAM, socialPageKey } from '@repo/shared';
import type { SocialNoteRepository } from '../domain/social-note.repository.interface';

export interface LikeBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface LikeCachePort {
  del(...keys: string[]): Promise<void>;
}

@Injectable()
export class ToggleLikeNoteUsecase {
  constructor(
    private readonly repo: SocialNoteRepository,
    private readonly cache: LikeCachePort,
    private readonly bus?: LikeBus,
  ) {}

  async execute(args: { userId: string; noteId: string; ebookId: string; pageNumber: number }): Promise<{
    liked: boolean;
    likesCount: number;
  }> {
    const out = await this.repo.toggleLike(args.noteId, args.userId);
    await this.cache.del(socialPageKey(args.ebookId, args.pageNumber)).catch(() => undefined);
    await this.bus
      ?.xadd(SOCIAL_STREAM, {
        event: out.liked ? 'margin_note_liked' : 'margin_note_unliked',
        noteId: args.noteId,
        likesCount: out.likesCount,
        at: Date.now(),
      })
      .catch(() => undefined);
    return out;
  }
}
