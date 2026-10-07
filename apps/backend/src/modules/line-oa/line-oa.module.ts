// SSOT Phase 034 §5.1 — LINE OA module (service + REST + GraphQL)
// Canonical: apps/backend/src/modules/line-oa/line-oa.module.ts
// (legacy src/backend/modules/line-oa/line-oa.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
// LineAuthService is provided here (auth/line-auth.service is the OA-sync owner,
// Phase 034 scope — the broader AuthModule stays untouched).
import { Module } from '@nestjs/common';
import { LineOAService } from './line-oa.service';
import { LineOAController } from './line-oa.controller';
import { LineOAResolver } from './line-oa.resolver';
import { LineAuthService } from '../auth/line-auth.service';

@Module({
  controllers: [LineOAController],
  providers: [LineOAService, LineOAResolver, LineAuthService],
  exports: [LineOAService, LineAuthService],
})
export class LineOAModule {}
