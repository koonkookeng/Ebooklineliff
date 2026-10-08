// SSOT Phase 075 §5.1 — Inventory module wiring
// Canonical: apps/backend/src/modules/inventory/inventory.module.ts
// - Batch use-case (per-line lock -> txn -> audit), checkout lock service,
//   thermal labels (R2 vault), REST + GQL presentation.
// - PrismaService/RedisClusterService/R2StorageService from @Global Infra.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { batchLineLockKey, skuLockKey } from '@repo/shared';
import { InventoryLockAdapter } from './infrastructure/redis-lock.adapter';
import { PrismaInventoryRepository } from './infrastructure/prisma-inventory.repository';
import { BatchStockUpdateUseCase } from './application/batch-stock-update.usecase';
import { InventoryLockService } from './application/inventory-lock.service';
import { ThermalLabelService } from './application/thermal-label.service';
import { InventoryController } from './presentation/inventory.controller';
import { InventoryResolver } from './presentation/inventory.resolver';
import { OrderInventoryLockService } from '../order/inventory-lock.service';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryLockAdapter,
    PrismaInventoryRepository,
    {
      provide: BatchStockUpdateUseCase,
      useFactory: (repo: PrismaInventoryRepository, locks: InventoryLockAdapter, prisma: PrismaService) =>
        new BatchStockUpdateUseCase(repo, locks, { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) }, batchLineLockKey),
      inject: [PrismaInventoryRepository, InventoryLockAdapter, PrismaService],
    },
    {
      provide: InventoryLockService,
      useFactory: (repo: PrismaInventoryRepository, locks: InventoryLockAdapter, prisma: PrismaService) =>
        new InventoryLockService(repo, locks, { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) }, skuLockKey),
      inject: [PrismaInventoryRepository, InventoryLockAdapter, PrismaService],
    },
    {
      provide: ThermalLabelService,
      useFactory: (repo: PrismaInventoryRepository, r2: R2StorageService) => new ThermalLabelService(repo, r2),
      inject: [PrismaInventoryRepository, R2StorageService],
    },
    {
      provide: InventoryResolver,
      useFactory: (
        batch: BatchStockUpdateUseCase,
        labels: ThermalLabelService,
        repo: PrismaInventoryRepository,
      ) => new InventoryResolver(batch, labels, repo),
      inject: [BatchStockUpdateUseCase, ThermalLabelService, PrismaInventoryRepository],
    },
    {
      provide: OrderInventoryLockService,
      useFactory: (inventory: InventoryLockService) => new OrderInventoryLockService(inventory),
      inject: [InventoryLockService],
    },
  ],
  exports: [InventoryLockService, OrderInventoryLockService, PrismaInventoryRepository],
})
export class InventoryModule {}
