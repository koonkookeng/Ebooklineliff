// SSOT Phase 032 §5.1 — Permission module (audit + reverse geocoding)
// Canonical: apps/backend/src/modules/permission/permission.module.ts
// (legacy src/backend/modules/permission/permission.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { PermissionAuditService } from './permission-audit.service';
import { ReverseGeocodingService } from './reverse-geocoding.service';
import { PermissionAuditController } from './permission-audit.controller';

@Module({
  controllers: [PermissionAuditController],
  providers: [PermissionAuditService, ReverseGeocodingService],
  exports: [PermissionAuditService, ReverseGeocodingService],
})
export class PermissionModule {}
