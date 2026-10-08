// SSOT Phase 074 §5.1 — Product builder module wiring
// Canonical: apps/backend/src/modules/product-builder/product-builder.module.ts
// - DraftStorage (Redis+PG) + atomic publish service + R2 presign delegate.
// - PrismaService/R2/Redis from @Global InfraModule. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { DraftStorageService } from './services/draft-storage.service';
import { ProductBuilderService } from './services/product-builder.service';
import { R2AssetPipelineService } from './services/r2-asset-pipeline.service';
import { ProductBuilderController } from './controllers/product-builder.controller';
import { UploadPresignController } from './controllers/upload-presign.controller';
import { ProductBuilderResolver } from './resolvers/product-builder.resolver';

@Module({
  controllers: [ProductBuilderController, UploadPresignController],
  providers: [
    {
      provide: DraftStorageService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        DraftStorageService.withInfra(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: ProductBuilderService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        ProductBuilderService.withInfra(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: R2AssetPipelineService,
      useFactory: (r2: R2StorageService) => new R2AssetPipelineService(r2),
      inject: [R2StorageService],
    },
    {
      provide: ProductBuilderResolver,
      useFactory: (builder: ProductBuilderService) => new ProductBuilderResolver(builder),
      inject: [ProductBuilderService],
    },
  ],
  exports: [ProductBuilderService, DraftStorageService],
})
export class ProductBuilderModule {}
