// SSOT Phase 053 §5.1 — HlsStreamModule (signed-URL issuer + guards)
// Canonical: apps/backend/src/modules/stream/hls-stream.module.ts
// (legacy src/backend/modules/stream/hls-stream.module.ts)
// - useFactory wiring keeps the issuer tsx-importable (Phase 047 precedent).
// - PrismaService + RedisClusterService arrive via global InfraModule.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { HlsSignedStreamController } from './hls-stream.controller';
import { HlsEntitlementGuard } from './guards/hls-entitlement.guard';
import {
  HlsTokenGeneratorService,
  type HlsTokenDbPort,
  type HlsTokenRedisPort,
} from './hls-token-generator.service';

@Module({
  controllers: [HlsSignedStreamController],
  providers: [
    {
      provide: HlsTokenGeneratorService,
      useFactory: (redis: RedisClusterService, prisma: PrismaService): HlsTokenGeneratorService =>
        new HlsTokenGeneratorService(
          redis as unknown as HlsTokenRedisPort,
          prisma as unknown as HlsTokenDbPort,
        ),
      inject: [RedisClusterService, PrismaService],
    },
    HlsEntitlementGuard,
  ],
  exports: [HlsTokenGeneratorService],
})
export class HlsStreamModule {}
