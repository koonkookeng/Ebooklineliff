// SSOT Phase 043 Task 3 — VideoUploadService (presigned parts + lifecycle)
// Canonical: apps/backend/src/modules/stream/services/video-upload.service.ts
// (legacy src/backend/modules/stream/services/video-upload.service.ts)
// - initiate: lesson guard → VideoAsset upsert (PENDING_UPLOAD) → N presigned
//   PUT part URLs (10MB, direct-to-R2, zero backend bytes).
// - complete: TRANSCODING_QUEUED + transcode enqueue (jobId returned).
// - handleWorkerEvent: R2 ObjectCreated → secret-checked → same as complete.
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  hlsOutputPrefix,
  rawVideoPartKey,
  rawVideoPrefix,
  VIDEO_RENDITION_LADDER,
  VIDEO_UPLOAD_PART_BYTES,
  type InitiateUpload,
  type VideoTranscodeJobPayload,
  type VideoWorkerEvent,
} from '@repo/shared';
import { partCountFor } from '../../../jobs/transcoder/ffmpeg-worker.processor';

export interface UploadTables {
  courseLesson: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  videoAsset: {
    upsert(args: unknown): Promise<{ id: string; status: string }>;
    findUnique(args: unknown): Promise<{ id: string; status: string; fileSizeBytes: bigint; rawStorageR2Key: string } | null>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface UploadVault {
  presignedPutUrl(objectKey: string, contentType: string, expiresInSeconds: number): string;
}

export interface UploadQueue {
  enqueue(job: { jobId: string; videoId: string; run: () => Promise<void> }): void;
  readonly depth: number;
}

export interface PartUrl {
  partNumber: number;
  r2Key: string;
  url: string;
}

const PART_URL_TTL_SEC = 3600;

function secretsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

@Injectable()
export class VideoUploadService {
  private readonly logger = new Logger(VideoUploadService.name);

  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly tables?: UploadTables,
    private readonly vault?: UploadVault,
    private readonly queue?: UploadQueue,
    private readonly runJob?: (job: VideoTranscodeJobPayload) => Promise<void>,
    private readonly workerSecret: string = process.env.VIDEO_WORKER_SECRET ?? '',
  ) {}

  async initiateUpload(input: InitiateUpload): Promise<{ videoId: string; partSizeBytes: number; partCount: number; parts: PartUrl[]; expiresAt: string }> {
    if (!this.tables || !this.vault) throw new NotFoundException('Upload service unavailable');
    const lesson = await this.tables.courseLesson.findUnique({ where: { id: input.lessonId } }).catch(() => null);
    if (!lesson) throw new NotFoundException('Lesson not found');
    const videoId = randomUUID();
    await this.tables.videoAsset.upsert({
      where: { lessonId: input.lessonId },
      create: { id: videoId, lessonId: input.lessonId, originalFileName: input.fileName.slice(0, 255), fileSizeBytes: BigInt(Math.floor(input.fileSizeBytes)), status: 'PENDING_UPLOAD', rawStorageR2Key: rawVideoPrefix(videoId) },
      update: { originalFileName: input.fileName.slice(0, 255), fileSizeBytes: BigInt(Math.floor(input.fileSizeBytes)), status: 'PENDING_UPLOAD', rawStorageR2Key: rawVideoPrefix(videoId) },
    });
    const partCount = partCountFor(input.fileSizeBytes);
    if (partCount === 0) throw new NotFoundException('Empty upload manifest');
    const parts: PartUrl[] = [];
    for (let i = 1; i <= partCount; i += 1) {
      const r2Key = rawVideoPartKey(videoId, i);
      parts.push({ partNumber: i, r2Key, url: this.vault.presignedPutUrl(r2Key, 'application/octet-stream', PART_URL_TTL_SEC) });
    }
    await this.tables.videoAsset.update({ where: { id: videoId }, data: { status: 'UPLOADING' } }).catch(() => undefined);
    return { videoId, partSizeBytes: VIDEO_UPLOAD_PART_BYTES, partCount, parts, expiresAt: new Date(Date.now() + PART_URL_TTL_SEC * 1000).toISOString() };
  }

  async getUploadStatus(videoId: string): Promise<{ videoId: string; status: string }> {
    const row = await this.tables?.videoAsset.findUnique({ where: { id: videoId } }).catch(() => null);
    if (!row) throw new NotFoundException('Video not found');
    return { videoId: row.id, status: row.status };
  }

  /** Parts are all in R2 → queue the transcode (idempotent per video). */
  async completeUpload(videoId: string): Promise<{ jobId: string; queued: boolean }> {
    if (!this.tables || !this.queue || !this.runJob) throw new NotFoundException('Upload service unavailable');
    const row = await this.tables.videoAsset.findUnique({ where: { id: videoId } }).catch(() => null);
    if (!row) throw new NotFoundException('Video not found');
    if (row.status === 'TRANSCODING_QUEUED' || row.status === 'TRANSCODING_PROCESSING' || row.status === 'READY') {
      return { jobId: `existing-${videoId}`, queued: false };
    }
    const jobId = randomUUID();
    const payload: VideoTranscodeJobPayload = {
      jobId,
      videoId,
      rawR2Key: row.rawStorageR2Key,
      outputPrefix: hlsOutputPrefix(videoId),
      resolutions: VIDEO_RENDITION_LADDER.map((r) => r.resolution),
      enableEncryption: true,
    };
    const runJob = this.runJob;
    this.queue.enqueue({ jobId, videoId, run: () => runJob(payload) });
    await this.tables.videoAsset.update({ where: { id: videoId }, data: { status: 'TRANSCODING_QUEUED' } }).catch(() => undefined);
    return { jobId, queued: true };
  }

  /** §5.2 worker webhook: R2 ObjectCreated → dispatch within 200ms. */
  async handleWorkerEvent(event: VideoWorkerEvent, presentedSecret: string): Promise<{ jobId: string; queued: boolean }> {
    if (!this.workerSecret || !secretsEqual(presentedSecret, this.workerSecret)) {
      throw new NotFoundException('Video not found');
    }
    const match = /^raw-videos\/([0-9a-f-]{36})\//.exec(event.r2Key);
    if (!match) throw new NotFoundException('Video not found');
    this.logger.debug(`[Video Worker] dispatch ${match[1]} (${event.size} bytes)`);
    return this.completeUpload(match[1]);
  }
}
