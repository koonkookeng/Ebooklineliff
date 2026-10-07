// SSOT Phase 046 §5.1 — ProgressModule (sync engine wiring)
// Canonical: apps/backend/src/modules/stream/progress/progress.module.ts
// (legacy src/backend/modules/stream/progress/progress.module.ts)
// - useFactory wiring keeps services tsx-importable. PrismaService arrives
//   via global InfraModule; edge/rate share the RedisClusterService singleton.
// - The 30s write-behind flush runs on a lightweight interval starter (no
//   scheduler dep, Phase 038 queue-drain precedent) owned by this module.
// - Registered into StreamModule (single stream ownership).
import { Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { ProgressBufferService } from '../../../infra/redis/progress-buffer.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { PROGRESS_FLUSH_INTERVAL_SEC } from '@repo/shared';
import { ProgressController } from './progress.controller';
import { ProgressResolver } from './progress.resolver';
import { ProgressService } from './progress.service';

/** 30s write-behind flush loop (unref'd; failures are per-row best-effort). */
@Injectable()
export class ProgressFlushStarter implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly progress: ProgressService) {}

  onModuleInit(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.progress.flushAllDue().catch(() => undefined);
    }, PROGRESS_FLUSH_INTERVAL_SEC * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

@Module({
  controllers: [ProgressController],
  providers: [
    {
      provide: ProgressBufferService,
      useFactory: (edge: RedisClusterService): ProgressBufferService => new ProgressBufferService(edge as never),
      inject: [RedisClusterService],
    },
    {
      provide: ProgressService,
      useFactory: (buffer: ProgressBufferService, prisma: PrismaService, edge: RedisClusterService): ProgressService =>
        new ProgressService(buffer, prisma as never, edge as never),
      inject: [ProgressBufferService, PrismaService, RedisClusterService],
    },
    ProgressResolver,
    ProgressFlushStarter,
  ],
  exports: [ProgressService, ProgressBufferService],
})
export class ProgressModule {}
