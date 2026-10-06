// SSOT Phase 018 §5.1 — library bounded-context module (DDD wiring)
// Canonical: apps/backend/src/modules/library/library.module.ts
// (legacy src/backend/modules/library/library.module.ts)
import { Module } from '@nestjs/common';
import { LibraryService } from './services/library.service';
import { AssetFormatterService } from './services/asset-formatter.service';
import { LibraryCacheRepository } from './repositories/library-cache.repository';
import { LibraryResolver } from './resolvers/library.resolver';
import { LibraryController } from './controllers/library.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule.
@Module({
  controllers: [LibraryController],
  providers: [LibraryService, AssetFormatterService, LibraryCacheRepository, LibraryResolver],
  exports: [LibraryService, LibraryCacheRepository],
})
export class LibraryModule {}
