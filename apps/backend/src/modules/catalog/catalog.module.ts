// SSOT Phase 008 §5.1 — catalog bounded-context module (DDD: domain/app/infra/presentation)
import { Module } from '@nestjs/common';
import { PrismaCatalogRepository } from './infrastructure/repositories/prisma-catalog.repository';
import { CreateProductUseCase } from './application/commands/create-product.command';
import { UpdateStockUseCase } from './application/commands/update-stock.command';
import { GetProductBySlugUseCase } from './application/queries/get-product-by-slug.query';
import { ListCatalogUseCase } from './application/queries/list-catalog.query';
import { CatalogResolver } from './presentation/graphql/catalog.resolver';
import { CatalogAdminController } from './presentation/rest/catalog-admin.controller';
import { PrismaProductSearchRepository } from './infrastructure/persistence/prisma-product-search.repository';
import { RedisSearchCacheAdapter } from './infrastructure/persistence/redis-search-cache.adapter';
import { SearchProductsHandler } from './application/handlers/search-products.handler';
import { PredictiveSearchHandler } from './application/handlers/predictive-search.handler';
import { ProductSearchResolver } from './presentation/resolvers/product-search.resolver';
import { ProductSearchController } from './presentation/rest/product-search.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
@Module({
  controllers: [CatalogAdminController, ProductSearchController],
  providers: [
    PrismaCatalogRepository,
    CreateProductUseCase,
    UpdateStockUseCase,
    GetProductBySlugUseCase,
    ListCatalogUseCase,
    CatalogResolver,
    PrismaProductSearchRepository,
    RedisSearchCacheAdapter,
    SearchProductsHandler,
    PredictiveSearchHandler,
    ProductSearchResolver,
  ],
  exports: [PrismaCatalogRepository, CreateProductUseCase, UpdateStockUseCase, GetProductBySlugUseCase, ListCatalogUseCase, PrismaProductSearchRepository, SearchProductsHandler, PredictiveSearchHandler],
})
export class CatalogModule {}
