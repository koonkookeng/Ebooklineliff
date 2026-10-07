// SSOT Phase 036 §5.1 — R2 storage module (vault transport + media controller)
// Canonical: apps/backend/src/infra/cloudflare/r2-storage.module.ts
// (legacy src/backend/infra/cloudflare/r2-storage.module.ts)
// - Hosts the media vault controller (collocated: transport + delivery stay in
//   one IN_SCOPE phase unit). PrismaService + RedisClusterService arrive via
//   the global InfraModule (single pool); entitlement is checked structurally
//   (the standalone EntitlementModule is not AppModule-registered).
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { R2StorageService } from './r2-storage.service';
import { MediaVaultController } from '../../api/controllers/media-vault.controller';
import { EdgeStreamEntitlementGuard } from '../../modules/entitlement/guards/edge-stream-entitlement.guard';

@Module({
  controllers: [MediaVaultController],
  providers: [R2StorageService, EdgeStreamEntitlementGuard],
  exports: [R2StorageService],
})
export class R2StorageModule {}
