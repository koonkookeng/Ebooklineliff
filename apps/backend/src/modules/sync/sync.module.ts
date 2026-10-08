// SSOT Phase 057 §5.1 — SyncModule (gateway + bus + write-back worker wiring)
// Canonical: apps/backend/src/modules/sync/sync.module.ts
// (legacy src/backend/modules/sync/sync.module.ts)
// - useFactory wiring keeps use-cases/worker tsx-importable (Phase 047+).
// - Write-back: shared in-memory FIFO per content type, drained every
//   SYNC_WRITEBACK_SEC (30s) into Prisma upserts with Max-Progress policy.
//   (BullMQ is not installed; the queue port is BullMQ-shaped for Phase 124.)
// - PrismaService + RedisClusterService arrive via global InfraModule.
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { RedisPubSubAdapter } from '../../infra/redis/redis-pubsub.adapter';
import { SYNC_WRITEBACK_SEC } from '@repo/shared';
import { ConflictResolverService } from './domain/services/conflict-resolver.service';
import { drainProgressQueues } from './application/workers/progress-persistence.worker';
import { RedisIoAdapter } from './infrastructure/adapters/redis-io.adapter';
import { ProgressSyncGateway } from './infrastructure/gateways/progress-sync.gateway';
import { SyncResolver } from './sync.resolver';

type QueueName = 'ebook_progress' | 'video_progress';

export class SyncWriteBackQueue {
  private readonly rows = new Map<QueueName, unknown[]>([
    ['ebook_progress', []],
    ['video_progress', []],
  ]);

  async enqueue(queue: string, payload: unknown): Promise<void> {
    this.rows.get(queue as QueueName)?.push(payload);
  }

  async drainBatch(queue: QueueName, max: number): Promise<unknown[]> {
    const rows = this.rows.get(queue) ?? [];
    return rows.splice(0, max);
  }
}

@Module({
  providers: [
    ConflictResolverService,
    SyncWriteBackQueue,
    {
      provide: RedisPubSubAdapter,
      useFactory: (edge: RedisClusterService): RedisPubSubAdapter => new RedisPubSubAdapter(edge),
      inject: [RedisClusterService],
    },
    {
      provide: RedisIoAdapter,
      useFactory: (rooms: RedisPubSubAdapter): RedisIoAdapter => new RedisIoAdapter(rooms),
      inject: [RedisPubSubAdapter],
    },
    {
      provide: ProgressSyncGateway,
      useFactory: (
        rooms: RedisPubSubAdapter,
        bus: RedisIoAdapter,
        edge: RedisClusterService,
        prisma: PrismaService,
        writeback: SyncWriteBackQueue,
      ): ProgressSyncGateway =>
        new ProgressSyncGateway(
          rooms,
          bus,
          { hset: (k, f) => edge.hset(k, f) },
          { enqueue: (q, p) => writeback.enqueue(q, p) },
          {
            register: async (args) => {
              await (prisma as unknown as {
                activeDeviceSession: { upsert(a: unknown): Promise<unknown> };
              }).activeDeviceSession.upsert({
                where: { socketId: args.socketId },
                create: { ...args },
                update: { lastActiveAt: new Date() },
              });
            },
            unregister: async (socketId) => {
              await (prisma as unknown as {
                activeDeviceSession: { deleteMany(a: unknown): Promise<unknown> };
              }).activeDeviceSession.deleteMany({ where: { socketId } });
            },
          },
        ),
      inject: [RedisPubSubAdapter, RedisIoAdapter, RedisClusterService, PrismaService, SyncWriteBackQueue],
    },
    SyncResolver,
  ],
  exports: [ProgressSyncGateway, ConflictResolverService, SyncWriteBackQueue],
})
export class SyncModule implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly writeback: SyncWriteBackQueue,
    private readonly conflicts: ConflictResolverService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.draining) return;
      this.draining = true;
      const db = this.prisma as unknown as {
        ebookReadingProgress: {
          findUnique(a: unknown): Promise<{ lastPage: number } | null>;
          upsert(a: unknown): Promise<{ lastPage: number }>;
        };
        courseLearningProgress: {
          findUnique(a: unknown): Promise<{ watchedSec: number } | null>;
          upsert(a: unknown): Promise<{ watchedSec: number }>;
        };
      };
      void drainProgressQueues(
        {
          queue: this.writeback,
          db: {
            upsertEbookProgress: async (a) => {
              const prev = await db.ebookReadingProgress
                .findUnique({ where: { userId_ebookId: { userId: a.userId, ebookId: a.ebookId } } })
                .catch(() => null);
              const lastPage = Math.max(prev?.lastPage ?? 0, a.lastPage);
              return db.ebookReadingProgress.upsert({
                where: { userId_ebookId: { userId: a.userId, ebookId: a.ebookId } },
                create: { userId: a.userId, ebookId: a.ebookId, lastPage, deviceId: a.deviceId },
                update: { lastPage, deviceId: a.deviceId },
              });
            },
            upsertVideoProgress: async (a) => {
              const prev = await db.courseLearningProgress
                .findUnique({ where: { userId_lessonId: { userId: a.userId, lessonId: a.lessonId } } })
                .catch(() => null);
              const watchedSec = Math.max(prev?.watchedSec ?? 0, a.watchedSec);
              return db.courseLearningProgress.upsert({
                where: { userId_lessonId: { userId: a.userId, lessonId: a.lessonId } },
                create: { userId: a.userId, lessonId: a.lessonId, watchedSec, isCompleted: a.isCompleted, deviceId: a.deviceId },
                update: { watchedSec, isCompleted: a.isCompleted, deviceId: a.deviceId },
              });
            },
          },
          conflicts: this.conflicts,
        },
      )
        .catch(() => undefined)
        .finally(() => {
          this.draining = false;
        });
    }, SYNC_WRITEBACK_SEC * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
