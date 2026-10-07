// SSOT Phase 043 Task 4 — FFmpeg worker processor (transcode lifecycle)
// Canonical: apps/backend/src/jobs/transcoder/ffmpeg-worker.processor.ts
// (legacy src/backend/jobs/transcoder/ffmpeg-worker.processor.ts)
// - Lifecycle: parts download → concat → key rotation row → FFmpeg (injected
//   runner; the binary never runs in unit tests) → segment upload →
//   rendition rows → READY. Errors mark FAILED (truncated message) and
//   rethrow for queue retry (VIDEO_MAX_RETRIES → DLQ, §10).
// - Part count derives deterministically from fileSizeBytes (no schema
//   change): parts = ceil(size / 10MB) under rawVideoPrefix(videoId).
// - tsx-safe (no param decorators). Zero new deps.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hlsMasterKey,
  hlsVariantKey,
  rawVideoPartKey,
  VIDEO_RENDITION_LADDER,
  VIDEO_UPLOAD_PART_BYTES,
  type VideoResolution,
  type VideoTranscodeJobPayload,
} from '@repo/shared';
import { buildFfmpegCommand } from './ffmpeg-command';
import { generateAes128Key, keyFileBytes, keyinfoFile } from './hls-encryptor';

export interface TranscodeTables {
  videoAsset: {
    update(args: unknown): Promise<unknown>;
  };
  videoRendition: {
    create(args: unknown): Promise<unknown>;
  };
  videoKeyRotation: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface TranscodeVault {
  getObjectBuffer(key: string): Promise<Buffer>;
  putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<unknown>;
}

export interface TranscodeMeta {
  fileSizeBytes: bigint | number;
}

export interface TranscodeMetaStore {
  findAsset(videoId: string): Promise<TranscodeMeta | null>;
}

export function partCountFor(fileSizeBytes: bigint | number): number {
  const size = typeof fileSizeBytes === 'bigint' ? fileSizeBytes : BigInt(Math.max(0, Math.floor(fileSizeBytes)));
  if (size <= 0n) return 0;
  const part = BigInt(VIDEO_UPLOAD_PART_BYTES);
  return Number((size + part - 1n) / part);
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (name.endsWith('.ts')) return 'video/mp2t';
  if (name.endsWith('.key')) return 'application/octet-stream';
  return 'application/octet-stream';
}

export class FfmpegWorkerProcessor {
  // NOTE: exec is injected (fake writes fixtures in tests; child_process in prod wiring).
  constructor(
    private readonly tables?: TranscodeTables,
    private readonly vault?: TranscodeVault,
    private readonly meta?: TranscodeMetaStore,
    private readonly exec: (cmd: string) => Promise<void> = async () => undefined,
  ) {}

  private async setStatus(videoId: string, status: string, errorMessage?: string): Promise<void> {
    await this.tables?.videoAsset
      .update({ where: { id: videoId }, data: { status, ...(errorMessage ? { errorMessage: errorMessage.slice(0, 2000) } : {}) } })
      .catch(() => undefined);
  }

  async process(job: VideoTranscodeJobPayload): Promise<{ segments: number; renditions: number }> {
    if (!this.tables || !this.vault || !this.meta) throw new Error('Transcoder unavailable');
    const asset = await this.meta.findAsset(job.videoId).catch(() => null);
    if (!asset) throw new Error('Video asset not found');
    await this.setStatus(job.videoId, 'TRANSCODING_PROCESSING');

    const workDir = await mkdtemp(join(tmpdir(), `transcode-${job.videoId}-`));
    try {
      // 1. Download + concatenate raw parts in order.
      const parts = partCountFor(asset.fileSizeBytes);
      if (parts === 0) throw new Error('Empty upload manifest');
      const chunks: Buffer[] = [];
      for (let i = 1; i <= parts; i += 1) {
        chunks.push(await this.vault.getObjectBuffer(rawVideoPartKey(job.videoId, i)));
      }
      const inputPath = join(workDir, 'input.mp4');
      await writeFile(inputPath, Buffer.concat(chunks));

      // 2. AES-128 rotation row + keyinfo (when enabled).
      let keyinfoPath: string | undefined;
      if (job.enableEncryption) {
        const { keyHex, ivHex } = generateAes128Key();
        await this.tables.videoKeyRotation.create({ data: { videoId: job.videoId, keySecretHex: keyHex, keyIvHex: ivHex } });
        const keyPath = join(workDir, 'enc.key');
        await writeFile(keyPath, keyFileBytes(keyHex));
        keyinfoPath = join(workDir, 'enc.keyinfo');
        await writeFile(keyinfoPath, keyinfoFile(`/api/v1/stream/key?videoId=${job.videoId}`, keyPath, ivHex));
      }

      // 3. Transcode (injected runner).
      const outDir = join(workDir, 'hls');
      const { command } = buildFfmpegCommand({ inputPath, outputDir: outDir, keyinfoPath, resolutions: job.resolutions });
      await this.exec(command);

      // 4. Upload every emitted file under the output prefix.
      const emitted = await this.listFiles(outDir);
      if (emitted.length === 0) throw new Error('FFmpeg produced no output');
      for (const file of emitted) {
        const body = await readFile(file.abs);
        await this.vault.putObjectBuffer(`${job.outputPrefix}/${file.rel}`, body, contentTypeFor(file.rel));
      }

      // 5. Rendition rows + READY.
      let renditions = 0;
      for (const resolution of job.resolutions) {
        const ladder = VIDEO_RENDITION_LADDER.find((r) => r.resolution === resolution);
        if (!ladder) continue;
        await this.tables.videoRendition.create({
          data: {
            videoId: job.videoId,
            resolution: resolution as VideoResolution,
            bitrateBps: ladder.bitrateBps,
            playlistR2Key: hlsVariantKey(job.videoId, resolution),
            segmentPrefix: `${job.outputPrefix}/${resolution}`,
          },
        });
        renditions += 1;
      }
      await this.tables.videoAsset.update({
        where: { id: job.videoId },
        data: { status: 'READY', hlsMasterR2Key: hlsMasterKey(job.videoId), errorMessage: null },
      });
      return { segments: emitted.length, renditions };
    } catch (error) {
      await this.setStatus(job.videoId, 'FAILED', error instanceof Error ? error.message : 'transcode failed');
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async listFiles(dir: string, base: string = dir): Promise<Array<{ abs: string; rel: string }>> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: Array<{ abs: string; rel: string }> = [];
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.listFiles(abs, base)));
      } else if (entry.isFile()) {
        out.push({ abs, rel: abs.slice(base.length + 1).replace(/\\/g, '/') });
      }
    }
    return out;
  }
}
