// SSOT Phase 094 Task 4 — Subtitle formatter (VTT/SRT + overlap guard + persist)
// Canonical: apps/backend/src/modules/ai-copilot/services/subtitle-formatter.service.ts
// - Validates timestamp integrity (§10 overlap checker), builds VTT/SRT,
//   uploads to R2 (zero-egress vault), persists VideoSubtitle + segments in
//   ONE $transaction (Gate 7). Port-based for DB-free tests.
import { BadRequestException, Injectable } from '@nestjs/common';
import { buildSrt, buildVtt, cuesOverlap, type CaptionCue } from '@repo/shared';

export interface SubtitleTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface SubtitleStorePort {
  saveSubtitle(
    tx: unknown,
    args: { lessonId: string; language: string; vttStorageR2: string; srtStorageR2: string },
  ): Promise<{ id: string }>;
  saveSegments(
    tx: unknown,
    args: Array<{ videoSubtitleId: string; segmentIndex: number; startTimeSec: number; endTimeSec: number; textContent: string }>,
  ): Promise<void>;
}

export interface R2PutPort {
  putObject(objectKey: string, body: string | Buffer, contentType: string): Promise<unknown>;
}

@Injectable()
export class SubtitleFormatterService {
  constructor(
    private readonly store: SubtitleStorePort,
    private readonly tx: SubtitleTx,
    private readonly r2?: R2PutPort,
  ) {}

  async formatAndStore(args: {
    lessonId: string;
    language: string;
    cues: CaptionCue[];
  }): Promise<{ subtitleId: string; vttUrl: string; srtUrl: string; cueCount: number }> {
    if (args.cues.length === 0) throw new BadRequestException('No cues to format');
    if (cuesOverlap(args.cues)) throw new BadRequestException('Overlapping subtitle timestamps');
    const vtt = buildVtt(args.cues);
    const srt = buildSrt(args.cues);
    const vttKey = `subtitles/${args.lessonId}/${args.language.toLowerCase()}.vtt`;
    const srtKey = `subtitles/${args.lessonId}/${args.language.toLowerCase()}.srt`;
    await this.r2?.putObject(vttKey, vtt, 'text/vtt').catch(() => undefined);
    await this.r2?.putObject(srtKey, srt, 'text/srt').catch(() => undefined);
    const subtitleId = await this.tx.run(async (tx) => {
      const sub = await this.store.saveSubtitle(tx, {
        lessonId: args.lessonId,
        language: args.language,
        vttStorageR2: vttKey,
        srtStorageR2: srtKey,
      });
      await this.store.saveSegments(
        tx,
        args.cues.map((c, i) => ({
          videoSubtitleId: sub.id,
          segmentIndex: i,
          startTimeSec: c.startTimeSec,
          endTimeSec: c.endTimeSec,
          textContent: c.text,
        })),
      );
      return sub.id;
    });
    return { subtitleId, vttUrl: vttKey, srtUrl: srtKey, cueCount: args.cues.length };
  }
}
