// SSOT Phase 095 Task 3 — Social reading GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/social-reading/presentation/graphql/social-reading.resolver.ts
// - Query.pageSocialNotes / Mutations createMarginNote + toggleLikeNote.
//   Server trusts JWT userId, never client userId (Gate 4).
// - Zero new deps.
import { Args, Query, Mutation, Resolver, Context, Int } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { CreateNoteUsecase } from '../../application/create-note.usecase';
import { FetchPageNotesUsecase } from '../../application/fetch-page-notes.usecase';
import { ToggleLikeNoteUsecase } from '../../application/toggle-like-note.usecase';
import { CreateMarginNoteInput } from './dto/create-note.input';
import { CreateNotePayloadGql, LikeNotePayloadGql, MarginNoteGql } from './dto/social-note.type';

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string | null; displayName: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; displayName?: string } | undefined) ?? {};
  return { userId: user.id ?? null, displayName: user.displayName ?? 'นักอ่าน' };
}

function actorOf(ctx: LooseCtx): { userId: string; displayName: string } {
  const { userId, displayName } = ctxOf(ctx);
  if (!userId) throw new BadRequestException('Missing authentication');
  return { userId, displayName };
}

@Resolver('SocialReading')
export class SocialReadingResolver {
  constructor(
    private readonly create: CreateNoteUsecase,
    private readonly fetch: FetchPageNotesUsecase,
    private readonly likes: ToggleLikeNoteUsecase,
  ) {}

  @Query('pageSocialNotes')
  async pageSocialNotes(
    @Args('ebookId') ebookId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Context() ctx: LooseCtx,
  ) {
    const rows = await this.fetch.execute({ readerUserId: actorOf(ctx).userId, ebookId, pageNumber });
    return rows.map((r) => {
      const out = new MarginNoteGql();
      out.id = r.id;
      out.userDisplayName = r.userDisplayName;
      out.userAvatarUrl = null;
      out.isAuthorNote = r.isAuthorNote;
      out.pageNumber = r.pageNumber;
      out.positionX = r.positionX;
      out.positionY = r.positionY;
      out.content = r.content;
      out.likesCount = r.likesCount;
      return out;
    });
  }

  @Mutation('createMarginNote')
  async createMarginNote(@Args('input') input: CreateMarginNoteInput, @Context() ctx: LooseCtx) {
    const { userId, displayName } = actorOf(ctx);
    const r = await this.create.execute({ userId, userDisplayName: displayName, input: { ...input } });
    const out = new CreateNotePayloadGql();
    out.noteId = r.noteId;
    out.flexMessageJson = r.flexMessageJson;
    return out;
  }

  @Mutation('toggleLikeNote')
  async toggleLikeNote(
    @Args('noteId') noteId: string,
    @Args('ebookId') ebookId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Context() ctx: LooseCtx,
  ) {
    const r = await this.likes.execute({ userId: actorOf(ctx).userId, noteId, ebookId, pageNumber });
    const out = new LikeNotePayloadGql();
    out.liked = r.liked;
    out.likesCount = r.likesCount;
    return out;
  }
}
