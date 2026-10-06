// SSOT Phase 023 §5.1 — Header integration module
// Canonical: apps/backend/src/modules/header/header.module.ts
// (legacy src/backend/modules/header/header.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { HeaderService } from './header.service';
import { HeaderResolver } from './header.resolver';

@Module({
  providers: [HeaderService, HeaderResolver],
  exports: [HeaderService],
})
export class HeaderModule {}
