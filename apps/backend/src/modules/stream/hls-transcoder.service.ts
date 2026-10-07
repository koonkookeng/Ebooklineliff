// SSOT Phase 036 Task 5 — HLS ladder planner (manifests + R2 upload + verify)
// Canonical: apps/backend/src/modules/stream/hls-transcoder.service.ts
// (legacy src/backend/modules/stream/hls-transcoder.service.ts)
// - HLS_LADDER manifests are generated purely (master + per-rendition variant
//   .m3u8, EXT-X-STREAM-INF bandwidth ladder) — byte-testable without ffmpeg.
// - Segment transcoding itself is the upstream worker seam (ffmpeg lives in
//   the transcode worker, OUT of this phase): uploadSegments() accepts
//   PRODUCED segments {index, resolution, data, durationSec} and persists them
//   to R2 + HlsSegmentMeta (idempotent @@unique upsert, Gate 7).
// - Zero new deps: Prisma SSOT + R2StorageService only.
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { HLS_LADDER, hlsObjectPrefix } from '@repo/shared';

export interface ProducedSegment {
  segmentIndex: number;
  resolution: string;
  data: string;
  durationSec: number;
}

interface TranscoderTables {
  courseLesson: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  hlsSegmentMeta: {
    upsert: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
  };
}

/** Master playlist referencing every rendition variant (pure builder). */
export function buildMasterPlaylist(lessonId: string): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const r of HLS_LADDER) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height},NAME="${r.resolution}"`);
    lines.push(`${hlsObjectPrefix(lessonId)}${r.resolution}/index.m3u8`);
  }
  return `${lines.join('\n')}\n`;
}

/** Variant playlist for one rendition (pure builder). */
export function buildVariantPlaylist(segmentCount: number, targetDurationSec: number): string {
  if (!Number.isInteger(segmentCount) || segmentCount <= 0) throw new BadRequestException('Invalid segment count');
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(targetDurationSec))}`, '#EXT-X-MEDIA-SEQUENCE:0'];
  for (let i = 0; i < segmentCount; i++) {
    lines.push(`#EXTINF:${targetDurationSec.toFixed(3)},`);
    lines.push(`seg-${i}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

@Injectable()
export class HlsTranscoderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
  ) {}

  private get tables(): TranscoderTables {
    return this.prisma as unknown as TranscoderTables;
  }

  /** Upload produced segments + manifests to R2 and record metas. */
  async uploadSegments(lessonId: string, segments: ProducedSegment[]): Promise<{ uploaded: number }> {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    if (!Array.isArray(segments) || segments.length === 0) throw new BadRequestException('No produced segments');
    const lesson = await this.tables.courseLesson.findFirst({ where: { id: lessonId } });
    if (!lesson) throw new BadRequestException('Unknown lesson');
    const prefix = hlsObjectPrefix(lessonId);
    let uploaded = 0;
    for (const seg of segments) {
      if (!Number.isInteger(seg.segmentIndex) || seg.segmentIndex < 0) throw new BadRequestException('Invalid segment index');
      if (typeof seg.data !== 'string' || !seg.data) throw new BadRequestException('Empty segment data');
      const key = `${prefix}${seg.resolution}/seg-${seg.segmentIndex}.ts`;
      await this.r2.putObject(key, seg.data, 'video/mp2t');
      await this.tables.hlsSegmentMeta.upsert({
        where: { lessonId_resolution_segmentIndex: { lessonId, resolution: seg.resolution, segmentIndex: seg.segmentIndex } },
        update: { r2ObjectKey: key, durationSec: seg.durationSec },
        create: { lessonId, resolution: seg.resolution, segmentIndex: seg.segmentIndex, r2ObjectKey: key, durationSec: seg.durationSec },
      });
      uploaded++;
    }
    // Master + variant manifests (overwritten idempotently per upload batch).
    await this.r2.putObject(`${prefix}master.m3u8`, buildMasterPlaylist(lessonId), 'application/x-mpegURL');
    const byResolution = new Map<string, ProducedSegment[]>();
    for (const seg of segments) {
      const list = byResolution.get(seg.resolution) ?? [];
      list.push(seg);
      byResolution.set(seg.resolution, list);
    }
    for (const [resolution, list] of byResolution) {
      const maxDuration = Math.max(...list.map((s) => s.durationSec));
      await this.r2.putObject(`${prefix}${resolution}/index.m3u8`, buildVariantPlaylist(list.length, maxDuration), 'application/x-mpegURL');
    }
    return { uploaded };
  }

  /** Segment-count parity per lesson (true = ladder complete). */
  async verifyLadder(lessonId: string, expectedPerRendition: number): Promise<boolean> {
    if (!lessonId) return false;
    const count = await this.tables.hlsSegmentMeta.count({ where: { lessonId } }).catch(() => -1);
    return count === expectedPerRendition * HLS_LADDER.length;
  }
}
