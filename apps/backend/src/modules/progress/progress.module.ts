// SSOT Phase 064 §5.1 — ProgressModule (offline batch sync wiring)
// Canonical: apps/backend/src/modules/progress/progress.module.ts
// (legacy src/backend/modules/progress/progress.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 027–064).
// - PrismaService via global InfraModule; Redis dedupe via cluster setnx.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PayloadVerifierService } from './services/payload-verifier.service';
import { ProgressSyncService } from './services/progress-sync.service';
import { BatchSyncController } from './controllers/batch-sync.controller';
import { EbookProgressResolver } from './resolvers/ebook-progress.resolver';
import { CourseProgressResolver } from './resolvers/course-progress.resolver';

@Module({
  controllers: [BatchSyncController],
  providers: [
    {
      provide: PayloadVerifierService,
      useFactory: (edge: RedisClusterService): PayloadVerifierService =>
        new PayloadVerifierService({
          setnx: (key: string, value: string, ttl: number) => edge.setnx(key, value, ttl),
        }),
      inject: [RedisClusterService],
    },
    {
      provide: ProgressSyncService,
      useFactory: (prisma: PrismaService, verifier: PayloadVerifierService): ProgressSyncService =>
        new ProgressSyncService(prisma as never, verifier),
      inject: [PrismaService, PayloadVerifierService],
    },
    EbookProgressResolver,
    CourseProgressResolver,
  ],
  exports: [ProgressSyncService, PayloadVerifierService],
})
// NOTE: named OfflineProgressModule — StreamModule already owns the
// ProgressModule class name (its write-behind progress submodule).
export class OfflineProgressModule {}
