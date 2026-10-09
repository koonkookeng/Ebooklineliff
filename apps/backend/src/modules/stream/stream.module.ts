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
import { ScrubbingController } from './controllers/scrubbing.controller';
import { ThumbnailScrubbingService } from './services/thumbnail-scrubbing.service';
import { VttGeneratorProcessor } from './processors/vtt-generator.processor';
import { ScrubbingResolver } from '../../api/graphql/resolvers/scrubbing.resolver';
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
// Phase 100: room gatekeeper (edge-first verdicts + 30s tokens + SSE kicks).
import { LiveAccessController } from './live-access.controller';
import { LiveGatekeeperService, type GateCache } from './live-gatekeeper.service';
import { LiveStreamGateway } from './live-stream.gateway';
import { LiveStreamResolver } from '../../api/graphql/live-stream.resolver';
import { PrismaLiveGatekeeperRepository } from './services/live-gatekeeper.repository';
// Phase 102: VOD pipeline (ledger + FIFO worker + lesson attach + webhook).
import { LiveStreamWebhookController } from '../../api/webhooks/live-stream-webhook.controller';
import { StreamResolver } from '../../api/graphql/resolvers/stream.resolver';
import { LiveToVodService, type VodEvents } from './application/live-to-vod.service';
import { TranscodeProcessorWorker } from './application/transcode-processor.worker';
import { VodSummaryService } from './application/vod-summary.service';
import { PrismaVodJobRepository } from './application/vod-job.repository';
import { FfmpegTranscoderAdapter } from './infrastructure/ffmpeg-transcoder.adapter';
import { R2VaultStorageAdapter } from './infrastructure/r2-vault-storage.adapter';
import { LessonService } from '../course/lesson.service';

function vodEventsOf(redis: RedisClusterService): VodEvents {
  return {
    xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => redis.xaddPipeline(s, b),
    set: (k: string, v: string, ...a: Array<string | number>) => redis.set(k, v, ...a),
    get: (k: string) => redis.get(k),
  };
}

const execAsync = promisify(exec);

@Module({
  imports: [R2StorageModule, ProgressModule],
  controllers: [UploadController, StreamController, StreamTranscodeController, TranscodeKeyController, ScrubbingController, LiveAccessController, LiveStreamWebhookController],
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
    ScrubbingResolver,
    // Phase 100 providers (port-based, tsx-importable like the rest).
    PrismaLiveGatekeeperRepository,
    {
      provide: LiveGatekeeperService,
      useFactory: (repo: PrismaLiveGatekeeperRepository, edge: RedisClusterService): LiveGatekeeperService =>
        new LiveGatekeeperService(repo, edge as unknown as GateCache),
      inject: [PrismaLiveGatekeeperRepository, RedisClusterService],
    },
    {
      provide: LiveStreamGateway,
      useFactory: (edge: RedisClusterService): LiveStreamGateway =>
        new LiveStreamGateway(
          { xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => edge.xaddPipeline(s, b) },
          edge as unknown as import('./live-stream.gateway').KickPubSub,
        ),
      inject: [RedisClusterService],
    },
    {
      provide: LiveStreamResolver,
      useFactory: (gate: LiveGatekeeperService): LiveStreamResolver => new LiveStreamResolver(gate),
      inject: [LiveGatekeeperService],
    },
    // ---- Phase 102 VOD pipeline (ledger + FIFO + lesson attach) ----
    PrismaVodJobRepository,
    FfmpegTranscoderAdapter,
    VodSummaryService,
    LessonService,
    {
      provide: R2VaultStorageAdapter,
      useFactory: (vault: R2StorageService): R2VaultStorageAdapter =>
        new R2VaultStorageAdapter(vault as never),
      inject: [R2StorageService],
    },
    {
      provide: TranscodeProcessorWorker,
      useFactory: (
        ledger: PrismaVodJobRepository,
        vault: R2VaultStorageAdapter,
        ffmpeg: FFmpegTranscoderService,
        lessons: LessonService,
        summary: VodSummaryService,
        redis: RedisClusterService,
      ): TranscodeProcessorWorker =>
        new TranscodeProcessorWorker(
          ledger,
          vault,
          ffmpeg,
          lessons,
          summary,
          {
            // BDD-1 LINE step: enrolled-student broadcast rides the 084
            // campaign lane; the worker's live.vod.ready stream event (below)
            // is the reliable instant fan-out. Best-effort hook kept here.
            notifyVodReady: async () => undefined,
          },
          vodEventsOf(redis),
        ),
      inject: [PrismaVodJobRepository, R2VaultStorageAdapter, FFmpegTranscoderService, LessonService, VodSummaryService, RedisClusterService],
    },
    {
      provide: LiveToVodService,
      useFactory: (ledger: PrismaVodJobRepository, queue: VideoTranscodeQueue, redis: RedisClusterService, worker: TranscodeProcessorWorker): LiveToVodService =>
        new LiveToVodService(ledger, queue, vodEventsOf(redis), (job) => worker.run(job)),
      inject: [PrismaVodJobRepository, VideoTranscodeQueue, RedisClusterService, TranscodeProcessorWorker],
    },
    {
      provide: StreamResolver,
      useFactory: (pipeline: LiveToVodService, worker: TranscodeProcessorWorker, lessons: LessonService): StreamResolver =>
        new StreamResolver(pipeline, worker, lessons),
      inject: [LiveToVodService, TranscodeProcessorWorker, LessonService],
    },
    {
      provide: ThumbnailScrubbingService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): ThumbnailScrubbingService =>
        new ThumbnailScrubbingService(prisma as never, edge as never),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: VttGeneratorProcessor,
      useFactory: (prisma: PrismaService, vault: R2StorageService): VttGeneratorProcessor =>
        new VttGeneratorProcessor(prisma as never, vault as never, async (cmd: string) => {
          await execAsync(cmd);
        }),
      inject: [PrismaService, R2StorageService],
    },
  ],
  exports: [VideoUploadService, StreamService, FfmpegWorkerProcessor, VideoTranscodeQueue, FFmpegTranscoderService, TranscodeWorkerHost, TranscodeJobReaderService, ThumbnailScrubbingService, VttGeneratorProcessor, LiveGatekeeperService, PrismaLiveGatekeeperRepository],
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
