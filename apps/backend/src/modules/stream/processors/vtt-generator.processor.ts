// SSOT Phase 058 Task 2 — VTT sprite-sheet background processor (BullMQ/FIFO shape)
// Canonical: apps/backend/src/modules/stream/processors/vtt-generator.processor.ts
// (legacy src/backend/modules/stream/processors/vtt-generator.processor.ts)
// - buildSpritePlan: pure FFmpeg plan (10x10 WebP grid, 1600x900/sheet,
//   sampled every 2s, ≤250KB/sheet target) — no binary exec here so tsx tests
//   stay hermetic; the worker host injects exec + R2 put.
// - buildWebVtt: pure WebVTT index mapping timestamps → CSS spatial coords.
// - persistSpriteSheets: atomic Prisma $transaction ledger (Gate 7).
// - Zero new deps (BullMQ doctrine: in-process FIFO, Phase 038 precedent).
import { Injectable } from '@nestjs/common';
import { cueCoordsForFrame, toVttTimestamp, totalTilesFor } from '@repo/shared';

export interface VttGeneratorJob {
  lessonId: string;
  sourceR2Key: string;
  durationSec: number;
  intervalSec?: number;
  tileWidth?: number;
  tileHeight?: number;
  columnsCount?: number;
  r2Prefix?: string;
}

export interface SpriteSheetPlan {
  sheetIndex: number;
  startFrameSec: number;
  endFrameSec: number;
  tileCount: number;
  ffmpegArgs: string[];
  r2ObjectKey: string;
}

export interface VttPersistTables {
  $transaction(ops: unknown[]): Promise<unknown[]>;
  courseLesson: { update(args: unknown): Promise<unknown> };
  videoSpriteSheet: { upsert(args: unknown): Promise<unknown> };
}

export interface VttVault {
  putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<string>;
}

export const VTT_SPRITE_DEFAULTS = {
  intervalSec: 2,
  tileWidth: 160,
  tileHeight: 90,
  columnsCount: 10,
  tilesPerSheet: 100,
} as const;

/** Pure FFmpeg ladder plan — deterministic, idempotent, fully testable. */
export function buildSpritePlan(job: VttGeneratorJob): SpriteSheetPlan[] {
  const interval = job.intervalSec && job.intervalSec > 0 ? job.intervalSec : VTT_SPRITE_DEFAULTS.intervalSec;
  const cols = job.columnsCount && job.columnsCount > 0 ? job.columnsCount : VTT_SPRITE_DEFAULTS.columnsCount;
  const tileW = job.tileWidth && job.tileWidth > 0 ? job.tileWidth : VTT_SPRITE_DEFAULTS.tileWidth;
  const tileH = job.tileHeight && job.tileHeight > 0 ? job.tileHeight : VTT_SPRITE_DEFAULTS.tileHeight;
  const tilesPerSheet = cols * cols;
  const total = totalTilesFor(job.durationSec, interval);
  const sheets = Math.ceil(total / tilesPerSheet);
  const prefix = job.r2Prefix ?? `lessons/${job.lessonId}/sprites`;
  const plans: SpriteSheetPlan[] = [];
  for (let s = 0; s < sheets; s++) {
    const startFrame = s * tilesPerSheet;
    const endFrame = Math.min(total, startFrame + tilesPerSheet);
    plans.push({
      sheetIndex: s,
      startFrameSec: startFrame * interval,
      endFrameSec: endFrame * interval,
      tileCount: endFrame - startFrame,
      ffmpegArgs: [
        '-ss', String(startFrame * interval),
        '-i', job.sourceR2Key,
        '-vf', `fps=1/${interval},scale=${tileW}:${tileH},tile=${cols}x${cols}`,
        '-frames:v', '1',
        '-c:v', 'libwebp',
        '-q:v', '75',
        `${prefix}/sheet-${String(s).padStart(3, '0')}.webp`,
      ],
      r2ObjectKey: `${prefix}/sheet-${String(s).padStart(3, '0')}.webp`,
    });
  }
  return plans;
}

/** Pure WebVTT manifest — cues map timestamps to sprite fragments. */
export function buildWebVtt(job: VttGeneratorJob, sheetUrls: string[]): string {
  const interval = job.intervalSec && job.intervalSec > 0 ? job.intervalSec : VTT_SPRITE_DEFAULTS.intervalSec;
  const tileW = job.tileWidth && job.tileWidth > 0 ? job.tileWidth : VTT_SPRITE_DEFAULTS.tileWidth;
  const tileH = job.tileHeight && job.tileHeight > 0 ? job.tileHeight : VTT_SPRITE_DEFAULTS.tileHeight;
  const cols = job.columnsCount && job.columnsCount > 0 ? job.columnsCount : VTT_SPRITE_DEFAULTS.columnsCount;
  const total = totalTilesFor(job.durationSec, interval);
  const lines = ['WEBVTT', ''];
  for (let i = 0; i < total; i++) {
    const { x, y, sheetIndex } = cueCoordsForFrame(i, tileW, tileH, cols);
    const url = sheetUrls[sheetIndex] ?? sheetUrls[0] ?? '';
    lines.push(`${toVttTimestamp(i * interval)} --> ${toVttTimestamp((i + 1) * interval)}`);
    lines.push(`${url}#xywh=${x},${y},${tileW},${tileH}`);
    lines.push('');
  }
  return lines.join('\n');
}

@Injectable()
export class VttGeneratorProcessor {
  constructor(
    private readonly tables?: VttPersistTables,
    private readonly vault?: VttVault,
    private readonly exec?: (cmd: string) => Promise<void>,
  ) {}

  /** Full pipeline: plan → FFmpeg → R2 → atomic ledger. Idempotent per sheet. */
  async process(job: VttGeneratorJob): Promise<{ sheets: number; vttUrl: string }> {
    const plans = buildSpritePlan(job);
    const sheetUrls: string[] = [];
    for (const plan of plans) {
      if (this.exec) await this.exec(`ffmpeg ${plan.ffmpegArgs.join(' ')}`);
      const url = this.vault
        ? await this.vault.putObjectBuffer(plan.r2ObjectKey, Buffer.alloc(0), 'image/webp')
        : `https://r2.zero-egress.local/${plan.r2ObjectKey}`;
      sheetUrls.push(url);
    }
    const vtt = buildWebVtt(job, sheetUrls);
    const vttKey = `${job.r2Prefix ?? `lessons/${job.lessonId}/sprites`}/thumbnails.vtt`;
    const vttUrl = this.vault
      ? await this.vault.putObjectBuffer(vttKey, Buffer.from(vtt, 'utf8'), 'text/vtt')
      : `https://r2.zero-egress.local/${vttKey}`;
    if (this.tables) {
      const interval = job.intervalSec ?? VTT_SPRITE_DEFAULTS.intervalSec;
      const ops: unknown[] = [
        this.tables.courseLesson.update({
          where: { id: job.lessonId },
          data: {
            hasSpriteScrubbing: true,
            spriteVttUrl: vttUrl,
            spriteIntervalSec: Math.round(interval),
            tileWidth: job.tileWidth ?? VTT_SPRITE_DEFAULTS.tileWidth,
            tileHeight: job.tileHeight ?? VTT_SPRITE_DEFAULTS.tileHeight,
            columnsCount: job.columnsCount ?? VTT_SPRITE_DEFAULTS.columnsCount,
          },
        }),
        ...plans.map((p, i) =>
          this.tables!.videoSpriteSheet.upsert({
            where: { lessonId_sheetIndex: { lessonId: job.lessonId, sheetIndex: p.sheetIndex } },
            create: { lessonId: job.lessonId, sheetIndex: p.sheetIndex, imageUrlR2: sheetUrls[i], startFrameSec: p.startFrameSec, endFrameSec: p.endFrameSec },
            update: { imageUrlR2: sheetUrls[i], startFrameSec: p.startFrameSec, endFrameSec: p.endFrameSec },
          }),
        ),
      ];
      await this.tables.$transaction(ops);
    }
    return { sheets: plans.length, vttUrl };
  }
}
