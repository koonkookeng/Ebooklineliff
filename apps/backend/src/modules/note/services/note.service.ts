// SSOT Phase 065 §5.2 — NoteService (core business logic + edge cache)
// Canonical: apps/backend/src/modules/note/services/note.service.ts
// (legacy src/backend/modules/note/services/note.service.ts)
// - Entitlement gate: lesson → section → course → productId (§5.2 verbatim);
//   preview lessons bypass. Ownership enforced on update/delete (403).
// - Edge cache: getNotesByLesson read-through 300s + invalidate on write;
//   note_created fanned to Redis Stream for heatmap (§7.1, best-effort).
// - Offline sync: client-generated UUIDs → idempotent create + LWW update.
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  CreateLessonNoteSchema,
  UpdateLessonNoteSchema,
  NoteSearchFilterSchema,
  NOTE_CACHE_TTL_SEC,
  NOTE_STREAM_KEY,
  noteCacheKey,
  formatNoteTimestamp,
  sanitizeNoteContent,
  type NoteSearchFilter,
} from '@repo/shared';

export interface NoteLessonRow {
  id: string;
  isPreview: boolean;
  section: { course: { productId: string } };
}

export interface NoteTables {
  courseLesson: {
    findUnique(args: unknown): Promise<NoteLessonRow | null>;
  };
  entitlement: {
    findUnique(args: unknown): Promise<unknown | null>;
  };
  lessonNote: {
    create(args: unknown): Promise<Record<string, unknown>>;
    findMany(args: unknown): Promise<Record<string, unknown>[]>;
    count(args: unknown): Promise<number>;
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    update(args: unknown): Promise<Record<string, unknown>>;
    delete(args: unknown): Promise<unknown>;
  };
}

export interface NoteCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface NoteRow {
  id: string;
  userId: string;
  lessonId: string;
  courseId: string;
  timestampSec: number;
  content: string;
  tags: string[];
  visibility: 'PRIVATE' | 'STUDY_GROUP' | 'PUBLIC';
  aiSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toNotePayload(row: Record<string, unknown>): NoteRow & { timestampFormatted: string } {
  const base = row as unknown as NoteRow;
  return { ...base, timestampFormatted: formatNoteTimestamp(Number(base.timestampSec ?? 0)) };
}

@Injectable()
export class NoteService {
  constructor(
    private readonly tables?: NoteTables,
    private readonly cache?: NoteCache,
    private readonly onNoteCreated?: (event: { userId: string; lessonId: string }) => void,
  ) {}

  private async resolveCourseId(lessonId: string): Promise<{ courseId: string; gated: boolean } | null> {
    if (!this.tables) return null;
    const lesson = await this.tables.courseLesson
      .findUnique({ where: { id: lessonId }, include: { section: { include: { course: true } } } })
      .catch(() => null);
    if (!lesson) return null;
    return { courseId: lesson.section.course.productId, gated: !lesson.isPreview };
  }

  private async assertEntitled(userId: string, lessonId: string): Promise<string | null> {
    const resolved = await this.resolveCourseId(lessonId);
    if (!resolved) return null;
    if (!resolved.gated || !this.tables) return resolved.courseId;
    const grant = await this.tables.entitlement
      .findUnique({ where: { userId_productId: { userId, productId: resolved.courseId } } })
      .catch(() => null);
    return grant ? resolved.courseId : null;
  }

  async createNote(userId: string, input: unknown): Promise<{ ok: boolean; note?: ReturnType<typeof toNotePayload>; error?: string }> {
    const parsed = CreateLessonNoteSchema.safeParse(input);
    if (!parsed.success || !this.tables) return { ok: false, error: 'INVALID_INPUT' };
    const courseId = await this.assertEntitled(userId, parsed.data.lessonId);
    if (!courseId) return { ok: false, error: 'FORBIDDEN' };
    const created = await this.tables.lessonNote
      .create({
        data: {
          userId,
          lessonId: parsed.data.lessonId,
          courseId,
          timestampSec: parsed.data.timestampSec,
          content: sanitizeNoteContent(parsed.data.content),
          tags: parsed.data.tags ?? [],
          visibility: parsed.data.visibility ?? 'PRIVATE',
        },
      })
      .catch(() => null);
    if (!created) return { ok: false, error: 'WRITE_FAILED' };
    const note = toNotePayload(created);
    await this.cache?.del(noteCacheKey(userId, note.lessonId)).catch(() => undefined);
    await this.cache
      ?.xaddPipeline(NOTE_STREAM_KEY, [{ userId, lessonId: note.lessonId, event: 'note_created', at: Date.now() }])
      .catch(() => undefined);
    try {
      this.onNoteCreated?.({ userId, lessonId: note.lessonId });
    } catch {
      // analytics fan-out best-effort
    }
    return { ok: true, note };
  }

  async getNotesByLesson(userId: string, lessonId: string): Promise<Array<ReturnType<typeof toNotePayload>>> {
    const key = noteCacheKey(userId, lessonId);
    try {
      const hit = await this.cache?.get(key);
      if (hit) return JSON.parse(hit) as Array<ReturnType<typeof toNotePayload>>;
    } catch {
      // cache fail-open
    }
    if (!this.tables) return [];
    const rows = await this.tables.lessonNote
      .findMany({ where: { userId, lessonId }, orderBy: { timestampSec: 'asc' } })
      .catch(() => []);
    const notes = rows.map(toNotePayload);
    await this.cache?.setex(key, NOTE_CACHE_TTL_SEC, JSON.stringify(notes)).catch(() => undefined);
    return notes;
  }

  async updateNote(userId: string, input: unknown): Promise<{ ok: boolean; note?: ReturnType<typeof toNotePayload>; error?: string }> {
    const parsed = UpdateLessonNoteSchema.safeParse(input);
    if (!parsed.success || !this.tables) return { ok: false, error: 'INVALID_INPUT' };
    const existing = await this.tables.lessonNote.findUnique({ where: { id: parsed.data.noteId } }).catch(() => null);
    if (!existing) return { ok: false, error: 'NOT_FOUND' };
    if (String(existing['userId']) !== userId) return { ok: false, error: 'FORBIDDEN' };
    const updated = await this.tables.lessonNote
      .update({
        where: { id: parsed.data.noteId },
        data: {
          content: sanitizeNoteContent(parsed.data.content),
          ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
          ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
        },
      })
      .catch(() => null);
    if (!updated) return { ok: false, error: 'WRITE_FAILED' };
    const note = toNotePayload(updated);
    await this.cache?.del(noteCacheKey(userId, note.lessonId)).catch(() => undefined);
    return { ok: true, note };
  }

  async deleteNote(userId: string, noteId: string): Promise<boolean> {
    if (!this.tables) return false;
    const existing = await this.tables.lessonNote.findUnique({ where: { id: noteId } }).catch(() => null);
    if (!existing || String(existing['userId']) !== userId) return false;
    const lessonId = String(existing['lessonId'] ?? '');
    await this.tables.lessonNote.delete({ where: { id: noteId } }).catch(() => null);
    await this.cache?.del(noteCacheKey(userId, lessonId)).catch(() => undefined);
    return true;
  }

  async searchMyNotes(userId: string, filter: unknown): Promise<{ notes: Array<ReturnType<typeof toNotePayload>>; totalCount: number; hasNextPage: boolean }> {
    const parsed = NoteSearchFilterSchema.safeParse(filter ?? {});
    const f: NoteSearchFilter = parsed.success ? parsed.data : { page: 1, limit: 20 };
    if (!this.tables) return { notes: [], totalCount: 0, hasNextPage: false };
    const where: Record<string, unknown> = { userId };
    if (f.courseId) where['courseId'] = f.courseId;
    if (f.lessonId) where['lessonId'] = f.lessonId;
    if (f.tag) where['tags'] = { has: f.tag };
    if (f.keyword) where['content'] = { contains: f.keyword, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.tables.lessonNote
        .findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (f.page - 1) * f.limit, take: f.limit })
        .catch(() => []),
      this.tables.lessonNote.count({ where }).catch(() => 0),
    ]);
    return { notes: rows.map(toNotePayload), totalCount: total, hasNextPage: f.page * f.limit < total };
  }

  /** Offline queue drain: client UUIDs → idempotent create + LWW update (§BDD-3). */
  async syncOfflineNotes(
    userId: string,
    items: Array<{ id: string; lessonId: string; timestampSec: number; content: string; tags?: string[]; updatedAt: string }>,
  ): Promise<{ synced: number; syncedIds: string[] }> {
    if (!this.tables || !Array.isArray(items)) return { synced: 0, syncedIds: [] };
    let synced = 0;
    const syncedIds: string[] = [];
    for (const item of items.slice(0, 100)) {
      try {
        const courseId = await this.assertEntitled(userId, String(item.lessonId));
        if (!courseId) continue;
        const existing = await this.tables.lessonNote.findUnique({ where: { id: String(item.id) } }).catch(() => null);
        if (existing) {
          if (String(existing['userId']) !== userId) continue;
          if (new Date(String(item.updatedAt)).getTime() > new Date(String(existing['updatedAt'])).getTime()) {
            await this.tables.lessonNote
              .update({
                where: { id: String(item.id) },
                data: { content: sanitizeNoteContent(String(item.content ?? '')), timestampSec: Math.max(0, Math.floor(Number(item.timestampSec) || 0)) },
              })
              .catch(() => null);
          }
          synced++;
          syncedIds.push(`note:${String(item.id)}`);
          continue;
        }
        await this.tables.lessonNote
          .create({
            data: {
              id: String(item.id),
              userId,
              lessonId: String(item.lessonId),
              courseId,
              timestampSec: Math.max(0, Math.floor(Number(item.timestampSec) || 0)),
              content: sanitizeNoteContent(String(item.content ?? '')),
              tags: Array.isArray(item.tags) ? item.tags.slice(0, 5) : [],
              visibility: 'PRIVATE',
            },
          })
          .catch(() => null);
        synced++;
        syncedIds.push(`note:${String(item.id)}`);
      } catch {
        // per-item best-effort; unacked ids stay queued client-side
      }
    }
    return { synced, syncedIds };
  }
}

