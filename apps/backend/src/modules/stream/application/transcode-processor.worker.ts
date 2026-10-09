// SSOT Phase 102 Task 4/6 — Transcode worker (fetch → ladder → R2 → lesson)
// Canonical: apps/backend/src/modules/stream/application/transcode-processor.worker.ts
// - run: stage recording bytes into the vault → FFmpeg ladder (044, AES-128)
//   → lesson attach (Gate 7) → deterministic summary → best-effort LINE
//   notify → ledger COMPLETE. Failures flip FAILED (ERROR UI path).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { VOD_STREAM, vodProgressKey } from '@repo/shared';
import type { VodEvents, VodJobLedger, VodNotifier, VodSummary } from './live-to-vod.service';
import type { LessonVodPort } from '../../course/lesson.service';
import { R2VaultStorageAdapter } from '../infrastructure/r2-vault-storage.adapter';
import { FFmpegTranscoderService } from '../ffmpeg.service';

@Injectable()
export class TranscodeProcessorWorker {
  constructor(
    private readonly ledger: VodJobLedger,
    private readonly vault: R2VaultStorageAdapter,
    private readonly ffmpeg: FFmpegTranscoderService,
    private readonly lessons: LessonVodPort,
    private readonly summary: VodSummary,
    private readonly notify: VodNotifier,
    private readonly events: VodEvents,
    private readonly publicBaseUrl = process.env['R2_PUBLIC_ORIGIN'] ?? 'https://vod.local',
    private readonly keyUri = process.env['HLS_KEY_URI'] ?? 'https://vod.local/keys',
  ) {}

  async run(job: { liveSessionId: string; lessonId: string; tenantId: string; rawSourceUrl?: string }): Promise<void> {
    const t0 = Date.now();
    try {
      if (!job.rawSourceUrl) throw new Error('Missing recording URL');
      const bytes = await this.vault.fetchBytes(job.rawSourceUrl);
      const inputR2Key = await this.vault.stageSource(job.liveSessionId, bytes);
      const lesson = await this.lessons.findLesson(job.lessonId).catch(() => null);
      const { masterPlaylistUrl } = await this.ffmpeg.runLessonJob({
        jobId: `vod-${job.liveSessionId}`,
        lessonId: job.lessonId,
        inputR2Key,
        keyUri: this.keyUri,
        publicBaseUrl: this.publicBaseUrl,
      });
      const durationSec = 0;
      const aiSummary = await this.summary
        .summarize({ lessonId: job.lessonId, title: lesson?.title ?? job.lessonId, durationSec })
        .catch(() => '');
      await this.lessons.attachVod(job.lessonId, { videoHlsUrl: masterPlaylistUrl, durationSec, aiSummaryText: aiSummary });
      await this.ledger.completeJob(job.liveSessionId, { hlsManifestPath: masterPlaylistUrl, durationSec });
      await this.events.set(vodProgressKey(job.lessonId), '100', 'EX', 300).catch(() => undefined);
      await this.notify.notifyVodReady({ lessonId: job.lessonId, sessionId: job.liveSessionId, hlsUrl: masterPlaylistUrl }).catch(() => undefined);
      await this.events
        .xaddPipeline(VOD_STREAM, [{ event: 'live.vod.ready', sessionId: job.liveSessionId, lessonId: job.lessonId, tookMs: Date.now() - t0, at: Date.now() }])
        .catch(() => undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'transcode failed';
      await this.ledger.failJob(job.liveSessionId, message.slice(0, 2000)).catch(() => undefined);
      await this.events
        .xaddPipeline(VOD_STREAM, [{ event: 'live.vod.failed', sessionId: job.liveSessionId, at: Date.now() }])
        .catch(() => undefined);
      throw e;
    }
  }
}
