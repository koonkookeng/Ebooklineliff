// SSOT Phase 030 §5.1 — Tenant theme module (branding + navbar customizer)
// Canonical: apps/backend/src/modules/tenant/tenant-theme.module.ts
// (legacy src/backend/modules/tenant/tenant-theme.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { ContrastCalculatorService } from './domain/services/contrast-calculator.service';
import { TenantThemeCache } from './infrastructure/cache/tenant-redis.cache';
import { TenantPrismaRepository } from './infrastructure/persistence/tenant-prisma.repository';
import { TenantThemeService } from './tenant-theme.service';
import { TenantThemeResolver } from './tenant-theme.resolver';
import { TenantThemeController } from './tenant-theme.controller';

@Module({
  controllers: [TenantThemeController],
  providers: [
    ContrastCalculatorService,
    TenantThemeCache,
    TenantPrismaRepository,
    TenantThemeService,
    TenantThemeResolver,
  ],
  exports: [TenantThemeService, ContrastCalculatorService],
})
export class TenantThemeModule {}
