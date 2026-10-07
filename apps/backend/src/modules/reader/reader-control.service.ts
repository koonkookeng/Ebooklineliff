// SSOT Phase 041 Task 3 — ReaderControlService (bookmarks/highlights/preferences)
// Canonical: apps/backend/src/modules/reader/reader-control.service.ts
// (legacy src/backend/modules/reader/reader-control.service.ts)
// - §5.1 flow verbatim: productId → EbookDetail id → Prisma writes →
//   `user:{u}:ebook:{e}:annotations` invalidation (1h container cache).
// - Gate 7: @@unique([userId,ebookId,pageNumber]) guards double-toggle;
//   P2002 on create resolves to the existing row (idempotent toggle-on).
// - Gate 8 seam: injectable annotation event sink (default no-op).
// - tsx-safe (no Nest parameter decorators; structural Prisma/Cache ports);
//   zero new deps.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  annotationCacheKey,
  ANNOTATION_CACHE_TTL_SEC,
  ReaderPreferenceSchema,
  ThemeModeEnum,
  type BookmarkToggleResult,
  type CreateBookmarkInput,
  type CreateHighlightInput,
  type ReaderPreference,
} from '@repo/shared';

interface BookmarkRow {
  id: string;
  pageNumber: number;
  chapterTitle: string | null;
  createdAt: Date;
}

interface HighlightRow {
  id: string;
  userId: string;
  ebookId: string;
  pageNumber: number;
  colorHex: string;
  boundingRectsJson: unknown;
  selectedText: string;
  noteText: string | null;
  createdAt: Date;
}

interface PreferenceRow {
  theme: string;
  fontSizePx: number;
  fontFamily: string;
  lineSpacing: number | { toNumber(): number };
  autoHideControls: boolean;
}

export interface ReaderControlPrisma {
  ebookDetail: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  ebookBookmark: {
    findUnique(args: unknown): Promise<BookmarkRow | null>;
    findMany(args: unknown): Promise<BookmarkRow[]>;
    create(args: unknown): Promise<BookmarkRow>;
    delete(args: unknown): Promise<unknown>;
  };
  ebookHighlight: {
    findMany(args: unknown): Promise<HighlightRow[]>;
    findUnique(args: unknown): Promise<HighlightRow | null>;
    create(args: unknown): Promise<HighlightRow>;
    delete(args: unknown): Promise<unknown>;
  };
  userReaderPreference: {
    findUnique(args: unknown): Promise<PreferenceRow | null>;
    upsert(args: unknown): Promise<PreferenceRow>;
  };
}

export interface ReaderControlCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export interface AnnotationEvent {
  kind: 'BOOKMARK_TOGGLED' | 'HIGHLIGHT_CREATED' | 'THEME_PREFERENCE_CHANGED';
  userId: string;
  productId?: string;
  pageNumber?: number;
}

function toBookmarkPayload(row: BookmarkRow) {
  return {
    id: row.id,
    pageNumber: row.pageNumber,
    chapterTitle: row.chapterTitle,
    createdAt: row.createdAt.toISOString(),
  };
}

function toHighlightPayload(row: HighlightRow) {
  return {
    id: row.id,
    pageNumber: row.pageNumber,
    colorHex: row.colorHex,
    boundingRectsJson: typeof row.boundingRectsJson === 'string' ? row.boundingRectsJson : JSON.stringify(row.boundingRectsJson),
    selectedText: row.selectedText,
    noteText: row.noteText,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPreference(row: PreferenceRow): ReaderPreference {
  // Sanitize stored rows (another writer may persist out-of-vocabulary values).
  const theme = ThemeModeEnum.safeParse(row.theme).success ? (row.theme as ReaderPreference['theme']) : 'LIGHT';
  const candidate = {
    theme,
    fontSizePx: row.fontSizePx,
    fontFamily: row.fontFamily,
    lineSpacing: typeof row.lineSpacing === 'number' ? row.lineSpacing : row.lineSpacing.toNumber(),
    autoHideControls: row.autoHideControls,
  };
  const verified = ReaderPreferenceSchema.safeParse(candidate);
  if (verified.success) return verified.data;
  return { theme: 'LIGHT', fontSizePx: 18, fontFamily: 'Prompt', lineSpacing: 1.5, autoHideControls: true };
}

@Injectable()
export class ReaderControlService {
  private readonly logger = new Logger(ReaderControlService.name);

  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly prisma?: ReaderControlPrisma,
    private readonly cache?: ReaderControlCache,
    private readonly onEvent?: (event: AnnotationEvent) => void,
  ) {}

  private emit(event: AnnotationEvent): void {
    try {
      this.onEvent?.(event);
    } catch (error) {
      this.logger.warn(`Annotation event sink failed (${event.kind})`);
      void error;
    }
  }

  private async ebookIdOrThrow(productId: string): Promise<string> {
    const ebook = await this.prisma!.ebookDetail.findUnique({ where: { productId } }).catch(() => null);
    if (!ebook) throw new NotFoundException('E-Book product record not found.');
    return ebook.id;
  }

  private async invalidate(userId: string, ebookId: string): Promise<void> {
    await this.cache?.del(annotationCacheKey(userId, ebookId)).catch(() => undefined);
  }

  async toggleBookmark(userId: string, input: CreateBookmarkInput): Promise<BookmarkToggleResult> {
    if (!this.prisma) throw new NotFoundException('Reader controls unavailable');
    const ebookId = await this.ebookIdOrThrow(input.productId);
    const key = { userId_ebookId_pageNumber: { userId, ebookId, pageNumber: input.pageNumber } };
    const existing = await this.prisma.ebookBookmark.findUnique({ where: key }).catch(() => null);
    let result: BookmarkToggleResult;
    if (existing) {
      await this.prisma.ebookBookmark.delete({ where: { id: existing.id } });
      result = { isBookmarked: false, bookmark: null };
    } else {
      try {
        const created = await this.prisma.ebookBookmark.create({
          data: { userId, ebookId, pageNumber: input.pageNumber, chapterTitle: input.chapterTitle },
        });
        result = { isBookmarked: true, bookmark: toBookmarkPayload(created) };
      } catch (error) {
        // Gate 7: concurrent double-toggle collapses to idempotent bookmarked.
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        const raced = await this.prisma.ebookBookmark.findUnique({ where: key }).catch(() => null);
        result = { isBookmarked: true, bookmark: raced ? toBookmarkPayload(raced) : null };
      }
    }
    await this.invalidate(userId, ebookId);
    this.emit({ kind: 'BOOKMARK_TOGGLED', userId, productId: input.productId, pageNumber: input.pageNumber });
    return result;
  }

  async saveHighlight(userId: string, input: CreateHighlightInput) {
    if (!this.prisma) throw new NotFoundException('Reader controls unavailable');
    const ebookId = await this.ebookIdOrThrow(input.productId);
    const created = await this.prisma.ebookHighlight.create({
      data: {
        userId,
        ebookId,
        pageNumber: input.pageNumber,
        colorHex: input.colorHex,
        boundingRectsJson: JSON.stringify(input.boundingRects),
        selectedText: input.selectedText,
        noteText: input.noteText,
      },
    });
    await this.invalidate(userId, ebookId);
    this.emit({ kind: 'HIGHLIGHT_CREATED', userId, productId: input.productId, pageNumber: input.pageNumber });
    return toHighlightPayload(created);
  }

  async deleteHighlight(userId: string, highlightId: string): Promise<boolean> {
    if (!this.prisma) throw new NotFoundException('Reader controls unavailable');
    const row = await this.prisma.ebookHighlight.findUnique({ where: { id: highlightId } }).catch(() => null);
    if (!row || row.userId !== userId) return false;
    await this.prisma.ebookHighlight.delete({ where: { id: highlightId } });
    await this.invalidate(userId, row.ebookId);
    return true;
  }

  async getAnnotations(userId: string, productId: string) {
    if (!this.prisma) return { bookmarks: [], highlights: [] };
    const ebook = await this.prisma.ebookDetail.findUnique({ where: { productId } }).catch(() => null);
    if (!ebook) return { bookmarks: [], highlights: [] };
    const key = annotationCacheKey(userId, ebook.id);
    const cached = await this.cache?.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as { bookmarks: unknown[]; highlights: unknown[] };
      } catch {
        // Corrupt edge entry → rebuild below.
      }
    }
    const [bookmarks, highlights] = await Promise.all([
      this.prisma.ebookBookmark.findMany({ where: { userId, ebookId: ebook.id }, orderBy: { pageNumber: 'asc' } }),
      this.prisma.ebookHighlight.findMany({ where: { userId, ebookId: ebook.id }, orderBy: { pageNumber: 'asc' } }),
    ]);
    const result = { bookmarks: bookmarks.map(toBookmarkPayload), highlights: highlights.map(toHighlightPayload) };
    await this.cache?.setex(key, ANNOTATION_CACHE_TTL_SEC, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  async getPreferences(userId: string): Promise<ReaderPreference> {
    const row = await this.prisma?.userReaderPreference.findUnique({ where: { userId } }).catch(() => null);
    if (!row) return { theme: 'LIGHT', fontSizePx: 18, fontFamily: 'Prompt', lineSpacing: 1.5, autoHideControls: true };
    return toPreference(row);
  }

  async updatePreferences(userId: string, input: ReaderPreference): Promise<ReaderPreference> {
    if (!this.prisma) throw new NotFoundException('Reader controls unavailable');
    const row = await this.prisma.userReaderPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: { ...input },
    });
    this.emit({ kind: 'THEME_PREFERENCE_CHANGED', userId });
    return toPreference(row);
  }
}
