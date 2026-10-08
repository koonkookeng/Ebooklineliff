// SSOT Phase 058 §5.2 — ThumbnailScrubbingService (manifest + entitlement + edge cache)
// Canonical: apps/backend/src/modules/stream/services/thumbnail-scrubbing.service.ts
// (legacy src/backend/modules/stream/thumbnail-scrubbing.service.ts)
// - getScrubbingManifest: Redis-first (24h) → Prisma lesson+sheets → in-memory
//   cue build (cueCoordsForFrame) → Redis set → manifest (<15KB VTT pointer).
// - Entitlement gate: preview lessons bypass; others require entitlement row;
//   missing spriteVttUrl → NotFound (ERROR state renders timestamp-only).
// - trackScrubSeek: fire-and-forget heatmap beacon → Redis stream
//   (stream:scrub:seek-events) for the AI drop-off engine (§7.1).
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  SCRUB_MANIFEST_TTL_SEC,
  cueCoordsForFrame,
  scrubManifestCacheKey,
  totalTilesFor,
  type ThumbnailCue,
  type VideoSpriteManifest,
} from '@repo/shared';

export interface ScrubLessonRow {
  id: string;
  isPreview: boolean;
  durationSec: number;
  spriteVttUrl: string | null;
  spriteIntervalSec: number;
  tileWidth: number;
  tileHeight: number;
  columnsCount: number;
  section: { course: { productId: string } };
}

export interface ScrubSheetRow {
  sheetIndex: number;
  imageUrlR2: string;
}

export interface ScrubTables {
  courseLesson: {
    findUnique(args: unknown): Promise<(ScrubLessonRow & { spriteSheets: ScrubSheetRow[] }) | null>;
  };
  entitlement: {
    findUnique(args: unknown): Promise<{ userId: string } | null>;
  };
  user: {
    findUnique(args: unknown): Promise<{ displayName: string | null } | null>;
  };
}

export interface ScrubCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  setex?(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  xadd?(key: string, fields: Record<string, string>): Promise<unknown>;
}

export const SCRUB_TILES_PER_SHEET_FALLBACK = 100;

@Injectable()
export class ThumbnailScrubbingService {
  constructor(
    private readonly tables?: ScrubTables,
    private readonly cache?: ScrubCache,
    private readonly tokenSecret: string = process.env.VIDEO_TOKEN_SECRET || process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
    private readonly onScrubSeek?: (event: { userId: string; lessonId: string; targetTimeSec: number }) => void,
  ) {}

  watermarkFor(userId: string, displayName: string | null): string {
    const hash = createHash('sha256').update(`${userId}:${this.tokenSecret}`).digest('hex').slice(0, 12);
    return `${displayName || 'Learner'} | ${hash}`;
  }

  async getScrubbingManifest(userId: string, lessonId: string): Promise<{ manifest: VideoSpriteManifest; watermarkText: string }> {
    const key = scrubManifestCacheKey(lessonId);
    const cached = await this.cache?.get(key).catch(() => null);
    if (cached) {
      try {
        const manifest = JSON.parse(cached) as VideoSpriteManifest;
        const user = await this.tables?.user.findUnique({ where: { id: userId } }).catch(() => null);
        return { manifest, watermarkText: this.watermarkFor(userId, user?.displayName ?? null) };
      } catch {
        // Corrupt edge entry → rebuild below (self-heal, fail-open read).
      }
    }
    if (!this.tables) throw new NotFoundException('Thumbnail scrubbing is not processed for this lesson.');
    const lesson = await this.tables.courseLesson
      .findUnique({ where: { id: lessonId }, include: { spriteSheets: { orderBy: { sheetIndex: 'asc' } }, section: { include: { course: true } } } })
      .catch(() => null);
    if (!lesson || !lesson.spriteVttUrl) {
      throw new NotFoundException('Thumbnail scrubbing is not processed for this lesson.');
    }
    if (!lesson.isPreview) {
      const row = await this.tables.entitlement
        .findUnique({ where: { userId_productId: { userId, productId: lesson.section.course.productId } } })
        .catch(() => null);
      if (!row) throw new ForbiddenException('ท่านยังไม่มีสิทธิ์เข้าถึงบทเรียนนี้');
    }
    const interval = lesson.spriteIntervalSec > 0 ? lesson.spriteIntervalSec : 2;
    const tileW = lesson.tileWidth > 0 ? lesson.tileWidth : 160;
    const tileH = lesson.tileHeight > 0 ? lesson.tileHeight : 90;
    const cols = lesson.columnsCount > 0 ? lesson.columnsCount : 10;
    const totalFrames = totalTilesFor(lesson.durationSec, interval);
    const bySheet = new Map<number, string>();
    for (const s of lesson.spriteSheets) bySheet.set(s.sheetIndex, s.imageUrlR2);
    const cues: ThumbnailCue[] = [];
    for (let i = 0; i < totalFrames; i++) {
      const { x, y, sheetIndex } = cueCoordsForFrame(i, tileW, tileH, cols);
      const spriteUrl = bySheet.get(sheetIndex);
      if (!spriteUrl) continue;
      cues.push({ startTimeSec: i * interval, endTimeSec: (i + 1) * interval, spriteUrl, x, y, width: tileW, height: tileH });
    }
    const manifest: VideoSpriteManifest = {
      lessonId: lesson.id,
      vttUrl: lesson.spriteVttUrl,
      spriteIntervalSec: interval,
      tileWidth: tileW,
      tileHeight: tileH,
      columnsCount: cols,
      totalTiles: totalFrames,
      cues,
    };
    const raw = JSON.stringify(manifest);
    if (this.cache) {
      try {
        if (this.cache.setex) await this.cache.setex(key, SCRUB_MANIFEST_TTL_SEC, raw);
        else await this.cache.set(key, raw, 'EX', SCRUB_MANIFEST_TTL_SEC);
      } catch {
        // Edge cache is best-effort; manifest still returns (RamGuard intact).
      }
    }
    const user = await this.tables.user.findUnique({ where: { id: userId } }).catch(() => null);
    return { manifest, watermarkText: this.watermarkFor(userId, user?.displayName ?? null) };
  }

  /** §7.1 scrub_seek_jump beacon — never throws (analytics is best-effort). */
  async trackScrubSeek(userId: string, lessonId: string, targetTimeSec: number): Promise<{ recorded: boolean }> {
    const fields = { userId, lessonId, targetTimeSec: String(Math.max(0, targetTimeSec)), event: 'scrub_seek_jump', at: new Date().toISOString() };
    try {
      await this.cache?.xadd?.('stream:scrub:seek-events', fields);
    } catch {
      // fail-open
    }
    try {
      this.onScrubSeek?.({ userId, lessonId, targetTimeSec });
    } catch {
      // sink must never fail the player
    }
    return { recorded: true };
  }
}
