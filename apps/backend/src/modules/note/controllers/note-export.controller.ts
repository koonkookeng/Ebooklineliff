// SSOT Phase 065 Task 7 — NoteExportController (REST PDF export + offline sync)
// Canonical: apps/backend/src/modules/note/controllers/note-export.controller.ts
// (legacy src/backend/modules/note/controllers/note-export.controller.ts)
// - CRUD: GET /api/v1/notes?lessonId, POST /api/v1/notes, PATCH, DELETE,
//   POST /search, GET /summary?lessonId (LIFF-friendly REST over the same
//   service that backs the code-first GQL resolver — no logic duplication).
// - POST /api/v1/notes/export { lessonId } → R2 presigned URL (JWT).
// - POST /api/v1/notes/sync { items[] } → offline queue drain (LWW, JWT).
// - Zero new deps.
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { NoteService } from '../services/note.service';
import { NotePdfExporterService } from '../services/note-pdf-exporter.service';
import { NoteAiSummarizerService } from '../services/note-ai-summarizer.service';

interface NoteReq {
  user?: { id?: string };
}

interface SyncItem {
  id: string;
  lessonId: string;
  timestampSec: number;
  content: string;
  tags?: string[];
  updatedAt: string;
}

@Controller('api/v1/notes')
export class NoteExportController {
  constructor(
    private readonly notes: NoteService,
    private readonly exporter: NotePdfExporterService,
    private readonly summarizer: NoteAiSummarizerService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Query('lessonId') lessonId: string, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    if (!lessonId) throw new BadRequestException('lessonId required');
    return this.notes.getNotesByLesson(userId, String(lessonId));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: Record<string, unknown>, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const res = await this.notes.createNote(userId, body ?? {});
    if (!res.ok || !res.note) throw new BadRequestException(res.error ?? 'CREATE_FAILED');
    return res.note;
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async update(@Body() body: Record<string, unknown>, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const res = await this.notes.updateNote(userId, body ?? {});
    if (!res.ok || !res.note) throw new BadRequestException(res.error ?? 'UPDATE_FAILED');
    return res.note;
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async remove(@Query('noteId') noteId: string, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return { deleted: await this.notes.deleteNote(userId, String(noteId ?? '')) };
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async search(@Body() body: { filter?: Record<string, unknown> }, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.notes.searchMyNotes(userId, body?.filter ?? {});
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  async summary(@Query('lessonId') lessonId: string, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    if (!lessonId) throw new BadRequestException('lessonId required');
    const notes = await this.notes.getNotesByLesson(userId, String(lessonId));
    return this.summarizer.summarize(notes.map((n) => String(n.content ?? '')));
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async export(@Body() body: { lessonId?: unknown }, @Req() req: NoteReq) {    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const lessonId = String(body?.lessonId ?? '');
    if (!lessonId) throw new BadRequestException('lessonId required');
    const notes = await this.notes.getNotesByLesson(userId, lessonId);
    const res = await this.exporter.exportLessonNotes(
      userId,
      lessonId,
      notes.map((n) => ({ timestampSec: Number(n.timestampSec ?? 0), content: String(n.content ?? '') })),
    );
    if (!res.ok) throw new BadRequestException(res.error ?? 'EXPORT_FAILED');
    return { url: res.url };
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async sync(@Body() body: { items?: SyncItem[] }, @Req() req: NoteReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.notes.syncOfflineNotes(userId, Array.isArray(body?.items) ? body.items : []);
  }
}
