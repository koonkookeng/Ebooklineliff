// SSOT Phase 033 §5.1 — Version module (auto-update check + fleet log)
// Canonical: apps/backend/src/modules/version/version.module.ts
// (legacy src/backend/modules/version/version.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { VersionService } from './version.service';
import { VersionController } from './version.controller';

@Module({
  controllers: [VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class VersionModule {}
