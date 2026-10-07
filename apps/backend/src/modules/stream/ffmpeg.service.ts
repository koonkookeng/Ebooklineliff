// SSOT Phase 044 Task 3 — FFmpegTranscoderService (§6.1 ladder + lifecycle)
// Canonical: apps/backend/src/modules/stream/ffmpeg.service.ts
// (legacy src/backend/modules/stream/ffmpeg.service.ts)
// - Pure spec-verbatim command (§6.1: 3000k/1500k/800k/400k, -hls_time 4,
//   -g 120, chunk_%03d.ts, prog.m3u8) with shell-escaped paths.
// - runLessonJob orchestrates the ledger lifecycle (progress milestones →
//   exec (injected; binary never runs in tests) → 2MB validation → R2 sync
//   → variant rows → COMPLETED; failures mark FAILED + cleanup + rethrow).
// - tsx-safe (no param decorators). Zero new deps.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import {
  HLS_SEGMENT_SECONDS,
  lessonHlsPrefix,
  lessonMasterKey,
  type TranscodeQuality,
} from '@repo/shared';
import { buildVariantMetadata, validateSegments } from './hls-segmenter.service';
import { R2UploaderService } from '../../infra/cloudflare/r2-uploader.service';
import { generateAes128Key, keyFileBytes, keyinfoFile } from '../../jobs/transcoder/hls-encryptor';

/** §6.1 ladder: [videoKbps, maxrateKbps, bufsizeKbps, audioKbps, w, h]. */
const LADDER_044: Array<{ quality: TranscodeQuality; videoKbps: number; maxrateKbps: number; bufsizeKbps: number; audioKbps: number; width: number; height: number }> = [
  { quality: 'RES_1080P', videoKbps: 3000, maxrateKbps: 3200, bufsizeKbps: 4500, audioKbps: 128, width: 1920, height: 1080 },
  { quality: 'RES_720P', videoKbps: 1500, maxrateKbps: 1600, bufsizeKbps: 2250, audioKbps: 128, width: 1280, height: 720 },
  { quality: 'RES_480P', videoKbps: 800, maxrateKbps: 900, bufsizeKbps: 1200, audioKbps: 96, width: 854, height: 480 },
  { quality: 'RES_360P', videoKbps: 400, maxrateKbps: 450, bufsizeKbps: 600, audioKbps: 64, width: 640, height: 360 },
];

function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_:\-/.,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Spec §6.1 command (order = ladder order; subset allowed). */
export function buildTranscode044Command(input: {
  inputPath: string;
  outputDir: string;
  keyinfoPath?: string;
  qualities?: TranscodeQuality[];
  segmentSeconds?: number;
}): string {
  const ladder = LADDER_044.filter((r) => !input.qualities || input.qualities.includes(r.quality));
  if (ladder.length === 0) throw new Error('No renditions selected');
  const seg = input.segmentSeconds ?? HLS_SEGMENT_SECONDS;
  const splits = ladder.map((_, i) => `[v${i + 1}]`).join('');
  const scales = ladder
    .map((r, i) => `[v${i + 1}]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease[v${i + 1}out]`)
    .join('; ');
  const maps = ladder
    .map((r, i) => `-map "[v${i + 1}out]" -c:v:${i} libx264 -b:v:${i} ${r.videoKbps}k -maxrate:v:${i} ${r.maxrateKbps}k -bufsize:v:${i} ${r.bufsizeKbps}k -preset slow -g 120 -keyint_min 120 -sc_threshold 0 -map a:0 -c:a:${i} aac -b:a:${i} ${r.audioKbps}k`)
    .join(' ');
  const varMap = ladder.map((_, i) => `v:${i},a:${i}`).join(' ');
  const keyinfo = input.keyinfoPath ? ` -hls_key_info_file ${shellEscape(input.keyinfoPath)}` : '';
  return [
    'ffmpeg -hide_banner -y',
    `-i ${shellEscape(input.inputPath)}`,
    `-filter_complex "[0:v]split=${ladder.length}${splits}; ${scales}"`,
    maps,
    '-f hls',
    `-hls_time ${seg}`,
    '-hls_playlist_type vod',
    keyinfo.trim(),
    `-hls_segment_filename "${input.outputDir}/%v/chunk_%03d.ts"`,
    '-master_pl_name "master.m3u8"',
    `-var_stream_map "${varMap}"`,
    `${input.outputDir}/%v/prog.m3u8`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Studio stepper milestone for a lifecycle stage. */
export function milestoneFor(stage: 'upload' | 'transcode' | 'r2sync' | 'done'): number {
  switch (stage) {
    case 'upload':
      return 10;
    case 'transcode':
      return 70;
    case 'r2sync':
      return 95;
    case 'done':
      return 100;
  }
}

export interface TranscodeLedger {
  setProgress(jobId: string, status: string, progressPercentage: number): Promise<void>;
  completeJob(jobId: string, result: { masterPlaylistUrl: string; encryptionKeyPath: string; variants: Array<{ quality: TranscodeQuality; bandwidth: number; width: number; height: number; playlistPath: string; totalChunks: number; avgChunkSizeBytes: number }> }): Promise<void>;
  failJob(jobId: string, errorMessage: string): Promise<void>;
}

export interface LessonTranscodeInput {
  jobId: string;
  lessonId: string;
  inputR2Key: string;
  keyUri: string;
  publicBaseUrl: string;
}

export interface LessonVault {
  getObjectBuffer(key: string): Promise<Buffer>;
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (name.endsWith('.ts')) return 'video/MP2T';
  if (name.endsWith('.key') || name.endsWith('.keyinfo')) return 'application/octet-stream';
  return 'application/octet-stream';
}

@Injectable()
export class FFmpegTranscoderService {
  private readonly logger = new Logger(FFmpegTranscoderService.name);

  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly ledger?: TranscodeLedger,
    private readonly vault?: LessonVault,
    private readonly uploader?: R2UploaderService,
    private readonly exec: (cmd: string) => Promise<void> = async () => undefined,
  ) {}

  async runLessonJob(input: LessonTranscodeInput): Promise<{ masterPlaylistUrl: string; variants: number }> {
    if (!this.ledger || !this.vault || !this.uploader) throw new Error('Transcoder unavailable');
    const workDir = await mkdtemp(join(tmpdir(), `lesson-${input.jobId}-`));
    try {
      await this.ledger.setProgress(input.jobId, 'PROCESSING_UPLOAD', milestoneFor('upload'));
      const source = await this.vault.getObjectBuffer(input.inputR2Key);
      const inputPath = join(workDir, 'input.mp4');
      await writeFile(inputPath, source);

      const { keyHex, ivHex } = generateAes128Key();
      const keyPath = join(workDir, 'enc.key');
      await writeFile(keyPath, keyFileBytes(keyHex));
      const keyinfoPath = join(workDir, 'enc.keyinfo');
      await writeFile(keyinfoPath, keyinfoFile(input.keyUri, keyPath, ivHex));

      await this.ledger.setProgress(input.jobId, 'TRANSCODING', milestoneFor('upload'));
      const outDir = join(workDir, 'hls');
      await this.exec(buildTranscode044Command({ inputPath, outputDir: outDir, keyinfoPath }));

      await this.ledger.setProgress(input.jobId, 'UPLOADING_R2', milestoneFor('transcode'));
      const prefix = lessonHlsPrefix(input.lessonId);
      const files = await this.collect(outDir, outDir);
      const tsFiles = files.filter((f) => f.rel.endsWith('.ts')).map((f) => ({ name: f.rel, sizeBytes: f.body.length }));
      const { ok, violations } = validateSegments(tsFiles);
      if (!ok) throw new Error(`Segment guard: ${violations[0]}`);
      await this.uploader.uploadAll(
        files.map((f) => ({ key: `${prefix}/${f.rel}`, body: f.body, contentType: contentTypeFor(f.rel) })),
      );
      // Key material rides the same vault (served short-lived by the key endpoint).
      const keyR2Path = `${prefix}/enc.key`;
      await this.uploader.uploadAll([{ key: keyR2Path, body: keyFileBytes(keyHex), contentType: 'application/octet-stream' }]);

      // FFmpeg %v expands to the variant index (0..3): playlists live at
      // {prefix}/{index}/prog.m3u8 — the ledger mirrors that layout exactly.
      const variants = LADDER_044.map((r, index) => {
        const meta = buildVariantMetadata({
          quality: r.quality,
          bandwidthBitsPerSec: r.videoKbps * 1000,
          width: r.width,
          height: r.height,
          playlistFileName: 'prog.m3u8',
          segments: tsFiles,
        });
        return { quality: r.quality, bandwidth: meta.bandwidthBitsPerSec, width: meta.resolutionWidth, height: meta.resolutionHeight, playlistPath: `${prefix}/${index}/prog.m3u8`, totalChunks: meta.chunkCount, avgChunkSizeBytes: meta.averageChunkSizeBytes };
      });
      const masterPlaylistUrl = `${input.publicBaseUrl}/${lessonMasterKey(input.lessonId)}`;
      await this.ledger.completeJob(input.jobId, { masterPlaylistUrl, encryptionKeyPath: keyR2Path, variants });
      return { masterPlaylistUrl, variants: variants.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transcode failed';
      this.logger.error(`Lesson transcode failed: ${input.jobId}`, message);
      await this.ledger.failJob(input.jobId, message.slice(0, 2000)).catch(() => undefined);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async collect(dir: string, base: string): Promise<Array<{ rel: string; body: Buffer }>> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: Array<{ rel: string; body: Buffer }> = [];
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await this.collect(abs, base)));
      else if (entry.isFile() && !entry.name.endsWith('.keyinfo')) {
        out.push({ rel: abs.slice(base.length + 1).replace(/\\/g, '/'), body: await readFile(abs) });
      }
    }
    return out;
  }
}
