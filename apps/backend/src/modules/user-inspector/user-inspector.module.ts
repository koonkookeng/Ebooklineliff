// SSOT Phase 110 §5.1 — Inspector module wiring
// Canonical: apps/backend/src/modules/user-inspector/user-inspector.module.ts
// - PrismaService + RedisClusterService from the global InfraModule.
// - AdminRbacGuard is provided by AdminUserModule (imported for DI).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { AdminUserModule } from '../admin/user-management/admin-user.module';
import { UserInspectorRepository } from './repositories/user-inspector.repository';
import { UserInspectorService } from './services/user-inspector.service';
import { RfmCalculatorService } from './services/rfm-calculator.service';
import { SecurityTelemetryService } from './services/security-telemetry.service';
import { UserInspectorController } from './controllers/user-inspector.controller';
import { UserInspectorResolver } from './resolvers/user-inspector.resolver';

@Module({
  imports: [AdminUserModule],
  controllers: [UserInspectorController],
  providers: [
    UserInspectorRepository,
    UserInspectorService,
    RfmCalculatorService,
    SecurityTelemetryService,
    UserInspectorResolver,
  ],
  exports: [UserInspectorService, RfmCalculatorService, SecurityTelemetryService],
})
export class UserInspectorModule {}
