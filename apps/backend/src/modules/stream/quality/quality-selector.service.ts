// SSOT Phase 067 Task 2 — QualitySelectorService (manifest + telemetry)
// Canonical: apps/backend/src/modules/stream/quality/quality-selector.service.ts
// (legacy src/backend/modules/stream/quality/quality-selector.service.ts)
// - getQualityManifest: entitlement gate (lesson → section → course →
//   productId; preview bypass) → variant ladder (§5.2 verbatim bitrates)
//   derived from the lesson's own HLS base → 1h edge cache. Issuance IS the
//   gate; segment auth rides the existing HLS session guard (no new token
//   format, no DRM regression).
// - reportTelemetry: Zod-gated ledger row + analytics stream (best-effort,
//   never blocks playback).
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  StreamTelemetryPayloadSchema,
  QUALITY_LADDER,
  streamManifestKey,
  streamTelemetryStream,
} from '@repo/shared';

export interface QualityLessonRow {
  id: string;
  videoHlsUrl: string;
  isPreview: boolean;
  section: { course: { productId: string } };
}

export interface QualityTables {
  courseLesson: {
    findUnique(args: unknown): Promise<QualityLessonRow | null>;
  };
  entitlement: {
    findUnique(args: unknown): Promise<unknown | null>;
  };
  videoStreamTelemetry: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface QualityCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
}

export interface QualityStream {
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

const LADDER_LABELS = ['1080p', '720p', '480p', '360p'] as const;

@Injectable()
export class QualitySelectorService {
  constructor(
    private readonly tables?: QualityTables,
    private readonly cache?: QualityCache,
    private readonly stream?: QualityStream,
  ) {}

  private variantUrls(masterUrl: string): string[] {
    try {
      const base = masterUrl.split('?')[0].replace(/\/[^/]*$/, '');
      return LADDER_LABELS.map((label) => `${base}/${label}.m3u8`);
    } catch {
      return LADDER_LABELS.map(() => masterUrl);
    }
  }

  async getQualityManifest(userId: string, lessonId: string): Promise<{ ok: boolean; manifest?: unknown; error?: string }> {
    const key = streamManifestKey(lessonId, userId);
    try {
      const hit = await this.cache?.get(key);
      if (hit) return { ok: true, manifest: JSON.parse(hit) as unknown };
    } catch {
      // cache fail-open
    }
    if (!this.tables) return { ok: false, error: 'UNAVAILABLE' };
    const lesson = await this.tables.courseLesson
      .findUnique({ where: { id: lessonId }, include: { section: { include: { course: true } } } })
      .catch(() => null);
    if (!lesson) return { ok: false, error: 'NOT_FOUND' };
    if (!lesson.isPreview) {
      const grant = await this.tables.entitlement
        .findUnique({ where: { userId_productId: { userId, productId: lesson.section.course.productId } } })
        .catch(() => null);
      if (!grant) return { ok: false, error: 'FORBIDDEN' };
    }
    const urls = this.variantUrls(lesson.videoHlsUrl);
    const manifest = {
      lessonId: lesson.id,
      masterPlaylistUrl: lesson.videoHlsUrl,
      defaultQuality: 'AUTO',
      variants: QUALITY_LADDER.map((rung, i) => ({
        quality: rung.quality,
        resolution: rung.resolution,
        bandwidthBps: rung.bandwidthBps,
        playlistUrl: urls[i] ?? lesson.videoHlsUrl,
      })),
      watermarkPayload: { text: `USER: ${userId.slice(0, 8)} | ABR`, timestamp: new Date().toISOString() },
    };
    await this.cache?.setex(key, 3600, JSON.stringify(manifest)).catch(() => undefined);
    return { ok: true, manifest };
  }

  async reportTelemetry(userId: string, body: unknown): Promise<{ recorded: boolean }> {
    const parsed = StreamTelemetryPayloadSchema.safeParse({ ...(body as Record<string, unknown>), userId });
    if (!parsed.success) return { recorded: false };
    const p = parsed.data;
    await this.tables?.videoStreamTelemetry
      .create({
        data: {
          userId,
          lessonId: p.lessonId,
          selectedQuality: p.selectedQuality,
          activeQuality: p.activeQuality,
          measuredMbps: p.measuredMbps,
          bufferStallCount: p.bufferStallCount,
          ramUsageMb: p.ramUsageMb,
        },
      })
      .catch(() => null);
    await this.stream
      ?.xaddPipeline(streamTelemetryStream(), [
        { userId, lessonId: p.lessonId, activeQuality: p.activeQuality, measuredMbps: p.measuredMbps, stalls: p.bufferStallCount, at: Date.now() },
      ])
      .catch(() => undefined);
    return { recorded: true };
  }
}
