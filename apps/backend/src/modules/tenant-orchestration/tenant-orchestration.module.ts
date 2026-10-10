// SSOT Phase 108 §5.1 — Tenant Orchestration Module
// Canonical: apps/backend/src/modules/tenant-orchestration/tenant-orchestration.module.ts
// - Wires services, controllers, resolvers.
// - PrismaService + RedisClusterService from global InfraModule.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { TenantProvisioningService } from './services/tenant-provisioning.service';
import { DomainVerificationService } from './services/domain-verification.service';
import { TenantQuotaEnforcerService } from './services/tenant-quota-enforcer.service';
import { TenantOrchestrationController } from './controllers/tenant-orchestration.controller';
import { TenantOrchestrationResolver } from './resolvers/tenant-orchestration.resolver';

@Module({
  controllers: [TenantOrchestrationController],
  providers: [
    TenantProvisioningService,
    DomainVerificationService,
    TenantQuotaEnforcerService,
    TenantOrchestrationResolver,
  ],
  exports: [
    TenantProvisioningService,
    DomainVerificationService,
    TenantQuotaEnforcerService,
  ],
})
export class TenantOrchestrationModule {}
