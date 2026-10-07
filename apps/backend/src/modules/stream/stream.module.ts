// SSOT Phase 043 §5.1 — StreamModule (upload + transcode + delivery wiring)
// Canonical: apps/backend/src/modules/stream/stream.module.ts
// (legacy src/backend/modules/stream/stream.module.ts)
// - R2 rides R2StorageModule; Prisma/Redis arrive via global InfraModule.
// - The FFmpeg binary runs through an injected exec (child_process in prod);
//   the queue is the in-process FIFO (no BullMQ dep, Phase 038 doctrine).
// - useFactory wiring keeps application services tsx-importable.
import { Module } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { FfmpegWorkerProcessor } from '../../jobs/transcoder/ffmpeg-worker.processor';
import { VideoTranscodeQueue } from '../../jobs/transcoder/video-transcode.queue';
import { StreamController } from './controllers/stream.controller';
import { UploadController } from './controllers/upload.controller';
import { StreamService } from './services/stream.service';
import { VideoUploadService } from './services/video-upload.service';

const execAsync = promisify(exec);

@Module({
  imports: [R2StorageModule],
  controllers: [UploadController, StreamController],
  providers: [
    VideoTranscodeQueue,
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
  ],
  exports: [VideoUploadService, StreamService, FfmpegWorkerProcessor, VideoTranscodeQueue],
})
export class StreamModule {}
