// SSOT Phase 123 §5.1 — storage composition module
// Canonical: apps/backend/src/modules/storage/storage.module.ts
// - Provides + exports the lifecycle/budget lanes over the global
//   InfraModule Redis + Prisma singletons and the R2 transport. The
//   LINE push port binds to the 122 LineMessagingClient transport.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { LineMessagingClient } from '../../infrastructure/external/clients/line/line-messaging.client';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2LifecycleService } from './services/r2-lifecycle.service';
import { StorageBudgetService } from './services/storage-budget.service';
import { StorageHandler } from './services/storage-handler.service';
import { StorageResolver } from './resolvers/storage.resolver';
import { StorageAdminController } from './controllers/storage-admin.controller';

@Module({
  imports: [R2StorageModule],
  providers: [
    LineMessagingClient,
    {
      provide: R2LifecycleService,
      useFactory: (prisma: PrismaService, r2: R2StorageService, redis: RedisClusterService) =>
        new R2LifecycleService(prisma, r2, redis),
      inject: [PrismaService, R2StorageService, RedisClusterService],
    },
    {
      provide: StorageBudgetService,
      useFactory: (prisma: PrismaService, line: LineMessagingClient) =>
        new StorageBudgetService(prisma, line),
      inject: [PrismaService, LineMessagingClient],
    },
    {
      provide: StorageHandler,
      useFactory: (lifecycle: R2LifecycleService, budget: StorageBudgetService, prisma: PrismaService) =>
        new StorageHandler(lifecycle, budget, prisma),
      inject: [R2LifecycleService, StorageBudgetService, PrismaService],
    },
    StorageResolver,
    StorageAdminController,
  ],
  exports: [R2LifecycleService, StorageBudgetService, StorageHandler],
})
export class StorageModule {}
