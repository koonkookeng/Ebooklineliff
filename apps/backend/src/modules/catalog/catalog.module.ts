// SSOT Phase 008 §5.1 — catalog bounded-context module (DDD: domain/app/infra/presentation)
import { Module } from '@nestjs/common';
import { PrismaCatalogRepository } from './infrastructure/repositories/prisma-catalog.repository';
import { CreateProductUseCase } from './application/commands/create-product.command';
import { UpdateStockUseCase } from './application/commands/update-stock.command';
import { GetProductBySlugUseCase } from './application/queries/get-product-by-slug.query';
import { ListCatalogUseCase } from './application/queries/list-catalog.query';
import { CatalogResolver } from './presentation/graphql/catalog.resolver';
import { CatalogAdminController } from './presentation/rest/catalog-admin.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
@Module({
  controllers: [CatalogAdminController],
  providers: [
    PrismaCatalogRepository,
    CreateProductUseCase,
    UpdateStockUseCase,
    GetProductBySlugUseCase,
    ListCatalogUseCase,
    CatalogResolver,
  ],
  exports: [PrismaCatalogRepository, CreateProductUseCase, UpdateStockUseCase, GetProductBySlugUseCase, ListCatalogUseCase],
})
export class CatalogModule {}
