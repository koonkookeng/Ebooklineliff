// SSOT Phase 071 §5/§10 — Tenant resolver module (engine wiring)
// Canonical: apps/backend/src/modules/tenant/tenant-resolver.module.ts
// - Provides TenantResolverService (Redis-first identifier lookup + branding)
//   and the public resolve/branding REST controller.
// - PrismaService + RedisClusterService come from @Global InfraModule.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantResolverController } from './tenant-resolver.controller';

@Module({
  controllers: [TenantResolverController],
  providers: [
    {
      provide: TenantResolverService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        TenantResolverService.withInfra(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
  ],
  exports: [TenantResolverService],
})
export class TenantResolverModule {}
