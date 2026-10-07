// SSOT Phase 043 §5.1 + Phase 044 §5.1 — StreamModule (delivery + transcode wiring)
// Canonical: apps/backend/src/modules/stream/stream.module.ts
// (legacy src/backend/modules/stream/stream.module.ts)
// - R2 rides R2StorageModule; Prisma/Redis arrive via global InfraModule.
// - The FFmpeg binary runs through an injected exec (child_process in prod);
//   the queue is the in-process FIFO (no BullMQ dep, Phase 038 doctrine).
// - Phase 044 adds the lesson job ledger (QUEUED→COMPLETED/FAILED), the
//   §6.1 ladder service, the FIFO-bound worker host, and the transcode
//   gateway (REST + GQL status + DRM key).
// - useFactory wiring keeps application services tsx-importable.
import { Module } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { R2UploaderService } from '../../infra/cloudflare/r2-uploader.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { FfmpegWorkerProcessor } from '../../jobs/transcoder/ffmpeg-worker.processor';
import { VideoTranscodeQueue } from '../../jobs/transcoder/video-transcode.queue';
import { StreamController } from './controllers/stream.controller';
import { UploadController } from './controllers/upload.controller';
import { FFmpegTranscoderService } from './ffmpeg.service';
import { HlsSegmenterService } from './hls-segmenter.service';
import { StreamService } from './services/stream.service';
import { TranscodeJobReaderService } from './services/transcode-job-reader.service';
import { VideoUploadService } from './services/video-upload.service';
import { StreamJobResolver } from './stream.resolver';
import { StreamTranscodeController, TranscodeKeyController } from './stream.controller';
import { StreamPlaybackResolver } from '../../api/graphql/stream/stream.resolver';
import { ProgressModule } from './progress/progress.module';
import { TranscodeWorkerHost } from './transcoder.worker';
import { VideoTranscodeProcessor044 } from './workers/video-transcode.processor';

const execAsync = promisify(exec);

@Module({
  imports: [R2StorageModule, ProgressModule],
  controllers: [UploadController, StreamController, StreamTranscodeController, TranscodeKeyController],
  providers: [
    VideoTranscodeQueue,
    HlsSegmenterService,
    {
      provide: FfmpegWorkerProcessor,
      useFactory: (prisma: PrismaService, vault: R2StorageService): FfmpegWorkerProcessor =>
        new FfmpegWorkerProcessor(
          prisma as never,
          vault as never,
          {
            findAsset: async (videoId: string) =>
              (prisma as unknown as { videoAsset: { findUnique(a: unknown): Promise<{ fileSizeBytes: bigint } | null> } }).videoAsset.findUnique({ where: { id: videoId } }),
          },
          async (cmd: string) => {
            await execAsync(cmd);
          },
        ),
      inject: [PrismaService, R2StorageService],
    },
    {
      provide: VideoUploadService,
      useFactory: (prisma: PrismaService, vault: R2StorageService, queue: VideoTranscodeQueue, processor: FfmpegWorkerProcessor): VideoUploadService =>
        new VideoUploadService(prisma as never, vault as never, queue, (payload) =>
          processor.process(payload).then(() => undefined),
        ),
      inject: [PrismaService, R2StorageService, VideoTranscodeQueue, FfmpegWorkerProcessor],
    },
    {
      provide: StreamService,
      useFactory: (prisma: PrismaService, vault: R2StorageService, edge: RedisClusterService): StreamService =>
        new StreamService(prisma as never, vault as never, edge as never),
      inject: [PrismaService, R2StorageService, RedisClusterService],
    },
    {
      provide: R2UploaderService,
      useFactory: (vault: R2StorageService): R2UploaderService => new R2UploaderService(vault as never),
      inject: [R2StorageService],
    },
    {
      provide: TranscodeJobReaderService,
      useFactory: (prisma: PrismaService): TranscodeJobReaderService => new TranscodeJobReaderService(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: FFmpegTranscoderService,
      useFactory: (prisma: PrismaService, vault: R2StorageService, uploader: R2UploaderService): FFmpegTranscoderService =>
        new FFmpegTranscoderService(
          {
            setProgress: async (jobId: string, status: string, progressPercentage: number) =>
              ledgerSetProgress(prisma, jobId, status, progressPercentage),
            completeJob: async (
              jobId: string,
              result: { masterPlaylistUrl: string; encryptionKeyPath: string; variants: Array<{ quality: 'RES_1080P' | 'RES_720P' | 'RES_480P' | 'RES_360P'; bandwidth: number; width: number; height: number; playlistPath: string; totalChunks: number; avgChunkSizeBytes: number }> },
            ) => ledgerCompleteJob(prisma, jobId, result),
            failJob: async (jobId: string, errorMessage: string) => ledgerFailJob(prisma, jobId, errorMessage),
          } as never,
          vault as never,
          uploader,
          async (cmd: string) => {
            await execAsync(cmd);
          },
        ),
      inject: [PrismaService, R2StorageService, R2UploaderService],
    },
    {
      provide: VideoTranscodeProcessor044,
      useFactory: (prisma: PrismaService, ffmpeg: FFmpegTranscoderService): VideoTranscodeProcessor044 =>
        new VideoTranscodeProcessor044(
          {
            findJob: async (jobId: string) =>
              (prisma as unknown as { videoTranscodeJob: { findUnique(a: unknown): Promise<{ id: string; lessonId: string; originalFileR2Path: string } | null> } }).videoTranscodeJob.findUnique({ where: { id: jobId } }),
          },
          ffmpeg,
        ),
      inject: [PrismaService, FFmpegTranscoderService],
    },
    {
      provide: TranscodeWorkerHost,
      useFactory: (prisma: PrismaService, queue: VideoTranscodeQueue, processor: VideoTranscodeProcessor044): TranscodeWorkerHost =>
        new TranscodeWorkerHost(prisma as never, queue, processor),
      inject: [PrismaService, VideoTranscodeQueue, VideoTranscodeProcessor044],
    },
    StreamJobResolver,
    StreamPlaybackResolver,
  ],
  exports: [VideoUploadService, StreamService, FfmpegWorkerProcessor, VideoTranscodeQueue, FFmpegTranscoderService, TranscodeWorkerHost, TranscodeJobReaderService],
})
export class StreamModule {}

async function ledgerSetProgress(prisma: PrismaService, jobId: string, status: string, progressPercentage: number): Promise<void> {
  await (prisma as unknown as { videoTranscodeJob: { update(a: unknown): Promise<unknown> } }).videoTranscodeJob
    .update({ where: { id: jobId }, data: { status, progressPercentage } })
    .catch(() => undefined);
}

async function ledgerCompleteJob(
  prisma: PrismaService,
  jobId: string,
  result: { masterPlaylistUrl: string; encryptionKeyPath: string; variants: Array<{ quality: string; bandwidth: number; width: number; height: number; playlistPath: string; totalChunks: number; avgChunkSizeBytes: number }> },
): Promise<void> {
  const db = prisma as unknown as {
    videoTranscodeJob: { update(a: unknown): Promise<unknown> };
    videoQualityVariant: { create(a: unknown): Promise<unknown> };
  };
  await db.videoTranscodeJob
    .update({ where: { id: jobId }, data: { status: 'COMPLETED', progressPercentage: 100, masterPlaylistUrl: result.masterPlaylistUrl, encryptionKeyPath: result.encryptionKeyPath, errorMessage: null } })
    .catch(() => undefined);
  for (const variant of result.variants) {
    await db.videoQualityVariant
      .create({ data: { transcodeJobId: jobId, quality: variant.quality, bandwidth: variant.bandwidth, width: variant.width, height: variant.height, playlistPath: variant.playlistPath, totalChunks: variant.totalChunks, avgChunkSizeBytes: variant.avgChunkSizeBytes } })
      .catch(() => undefined);
  }
}

async function ledgerFailJob(prisma: PrismaService, jobId: string, errorMessage: string): Promise<void> {
  await (prisma as unknown as { videoTranscodeJob: { update(a: unknown): Promise<unknown> } }).videoTranscodeJob
    .update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 2000) } })
    .catch(() => undefined);
}
