// SSOT Phase 080 §5.1 — Share module wiring
// Canonical: apps/backend/src/modules/share/share.module.ts
// - HMAC signer (env-first secret) -> Redis session/rate cache -> structural
//   Prisma repo -> generate/track use-cases -> REST + GQL. Reuses the 026
//   attribution and 079 commission engines by events only (never imports).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaShareRepository } from './infrastructure/share.repository';
import { ShareRedisCache } from './infrastructure/share-redis.cache';
import { AttributionSigner } from './domain/attribution.signer';
import { FlexBuilderEngine } from './domain/flex-builder.engine';
import { GenerateFlexShareUseCase } from './application/generate-flex-share.usecase';
import { TrackClickUseCase } from './application/track-click.usecase';
import { ShareController } from './presentation/share.controller';
import { ShareResolver } from './presentation/share.resolver';

@Module({
  controllers: [ShareController],
  providers: [
    AttributionSigner,
    FlexBuilderEngine,
    PrismaShareRepository,
    ShareRedisCache,
    {
      provide: GenerateFlexShareUseCase,
      useFactory: (
        repo: PrismaShareRepository,
        cache: ShareRedisCache,
        signer: AttributionSigner,
        builder: FlexBuilderEngine,
        prisma: PrismaService,
      ) =>
        new GenerateFlexShareUseCase(repo, cache, signer, builder, {
          run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)),
        }),
      inject: [PrismaShareRepository, ShareRedisCache, AttributionSigner, FlexBuilderEngine, PrismaService],
    },
    {
      provide: TrackClickUseCase,
      useFactory: (
        repo: PrismaShareRepository,
        cache: ShareRedisCache,
        signer: AttributionSigner,
        prisma: PrismaService,
      ) =>
        new TrackClickUseCase(repo, cache, signer, {
          run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)),
        }),
      inject: [PrismaShareRepository, ShareRedisCache, AttributionSigner, PrismaService],
    },
    {
      provide: ShareResolver,
      useFactory: (track: TrackClickUseCase, repo: PrismaShareRepository) =>
        new ShareResolver(track, repo),
      inject: [TrackClickUseCase, PrismaShareRepository],
    },
  ],
  exports: [GenerateFlexShareUseCase, TrackClickUseCase, PrismaShareRepository],
})
export class ShareModule {}
