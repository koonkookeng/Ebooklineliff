// SSOT Phase 065 §5.1 — NoteResolver (code-first GraphQL CRUD + search)
// Canonical: apps/backend/src/modules/note/resolvers/note.resolver.ts
// (legacy src/backend/modules/note/resolvers/note.resolver.ts)
// - Queries: getLessonNotes / searchMyNotes / generateAiLessonNoteSummary.
// - Mutations: createLessonNote / updateLessonNote / deleteLessonNote /
//   exportNotesToPdf. JWT identity from context; Zod gates in service.
// - Runtime is code-first; SDL supplement lives in
//   apps/backend/src/api/graphql/schemas/note.graphql.
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NoteService } from '../services/note.service';
import { NoteAiSummarizerService } from '../services/note-ai-summarizer.service';
import { NotePdfExporterService } from '../services/note-pdf-exporter.service';

interface NoteGqlContext {
  req?: { user?: { id?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

@Resolver('LessonNote')
export class NoteResolver {
  constructor(
    private readonly notes: NoteService,
    private readonly summarizer: NoteAiSummarizerService,
    private readonly exporter: NotePdfExporterService,
  ) {}

  private userId(ctx: NoteGqlContext): string {
    const id = ctx?.req?.user?.id;
    if (!id) throw new Error('Missing session identity');
    return id;
  }

  @Query('getLessonNotes')
  async getLessonNotes(@Args('lessonId') lessonId: string, @Context() ctx: NoteGqlContext) {
    return this.notes.getNotesByLesson(this.userId(ctx), String(lessonId));
  }

  @Query('searchMyNotes')
  async searchMyNotes(@Args('filter') filter: Record<string, unknown>, @Context() ctx: NoteGqlContext) {
    return this.notes.searchMyNotes(this.userId(ctx), filter ?? {});
  }

  @Query('generateAiLessonNoteSummary')
  async generateAiLessonNoteSummary(@Args('lessonId') lessonId: string, @Context() ctx: NoteGqlContext) {
    const userId = this.userId(ctx);
    const notes = await this.notes.getNotesByLesson(userId, String(lessonId));
    return this.summarizer.summarize(notes.map((n) => String(n.content ?? '')));
  }

  @Mutation('createLessonNote')
  async createLessonNote(@Args('input') input: Record<string, unknown>, @Context() ctx: NoteGqlContext) {
    const res = await this.notes.createNote(this.userId(ctx), input ?? {});
    if (!res.ok || !res.note) throw new Error(res.error ?? 'CREATE_FAILED');
    return res.note;
  }

  @Mutation('updateLessonNote')
  async updateLessonNote(@Args('input') input: Record<string, unknown>, @Context() ctx: NoteGqlContext) {
    const res = await this.notes.updateNote(this.userId(ctx), input ?? {});
    if (!res.ok || !res.note) throw new Error(res.error ?? 'UPDATE_FAILED');
    return res.note;
  }

  @Mutation('deleteLessonNote')
  async deleteLessonNote(@Args('noteId') noteId: string, @Context() ctx: NoteGqlContext) {
    return this.notes.deleteNote(this.userId(ctx), String(noteId));
  }

  @Mutation('exportNotesToPdf')
  async exportNotesToPdf(@Args('lessonId') lessonId: string, @Context() ctx: NoteGqlContext) {
    const userId = this.userId(ctx);
    const notes = await this.notes.getNotesByLesson(userId, String(lessonId));
    const res = await this.exporter.exportLessonNotes(
      userId,
      String(lessonId),
      notes.map((n) => ({ timestampSec: Number(n.timestampSec ?? 0), content: String(n.content ?? '') })),
    );
    if (!res.ok || !res.url) throw new Error(res.error ?? 'EXPORT_FAILED');
    return res.url;
  }
}
