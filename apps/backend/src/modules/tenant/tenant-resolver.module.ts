// SSOT Phase 071 §5/§10 + Phase 072 §5 — Tenant engine module wiring
// Canonical: apps/backend/src/modules/tenant/tenant-resolver.module.ts
// - 071: TenantResolverService (identifier lookup + branding) + REST.
// - 072: CompanyThemeService (full company theme + WCAG auto-correct) + REST.
// - PrismaService + RedisClusterService come from @Global InfraModule.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantResolverController } from './tenant-resolver.controller';
import { CompanyThemeService } from './company-theme.service';
import { CompanyThemeController } from './company-theme.controller';

@Module({
  controllers: [TenantResolverController, CompanyThemeController],
  providers: [
    {
      provide: TenantResolverService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        TenantResolverService.withInfra(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: CompanyThemeService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        CompanyThemeService.withInfra(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
  ],
  exports: [TenantResolverService, CompanyThemeService],
})
export class TenantResolverModule {}
