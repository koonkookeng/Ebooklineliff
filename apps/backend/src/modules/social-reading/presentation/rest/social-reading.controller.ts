// SSOT Phase 095 — Social reading REST (JWT userId only, proxy surface)
// Canonical: apps/backend/src/modules/social-reading/presentation/rest/social-reading.controller.ts
// - GET page / POST create / POST like. Server trusts JWT userId, never
//   client userId (Gate 4). Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { CreateNoteUsecase } from '../../application/create-note.usecase';
import { FetchPageNotesUsecase } from '../../application/fetch-page-notes.usecase';
import { ToggleLikeNoteUsecase } from '../../application/toggle-like-note.usecase';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { userId: string; displayName: string } {
  const user = (req['user'] as { id?: string; displayName?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { userId: user.id, displayName: user.displayName ?? 'นักอ่าน' };
}

@Controller('api/v1/social-notes')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SocialReadingController {
  constructor(
    private readonly createNote: CreateNoteUsecase,
    private readonly fetch: FetchPageNotesUsecase,
    private readonly likes: ToggleLikeNoteUsecase,
  ) {}

  @Get('page')
  page(@Req() req: LooseReq, @Query('ebookId') ebookId: string | undefined, @Query('page') pageRaw: string | undefined) {
    if (!ebookId || !pageRaw) throw new BadRequestException('Missing ebookId/page');
    return this.fetch.execute({ readerUserId: actorOf(req).userId, ebookId, pageNumber: Number(pageRaw) });
  }

  @Post('create')
  createNoteRoute(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, displayName } = actorOf(req);
    return this.createNote.execute({ userId, userDisplayName: displayName, input: (body ?? {}) as never });
  }

  @Post('like')
  like(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { noteId?: string; ebookId?: string; pageNumber?: number };
    if (!b.noteId || !b.ebookId || b.pageNumber == null) throw new BadRequestException('Missing noteId/ebookId/pageNumber');
    return this.likes.execute({ userId: actorOf(req).userId, noteId: b.noteId, ebookId: b.ebookId, pageNumber: b.pageNumber });
  }
}
