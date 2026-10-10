// SSOT Phase 109 §5.1 — Admin user module wiring
// Canonical: apps/backend/src/modules/admin/user-management/admin-user.module.ts
// - PrismaService + RedisClusterService come from the global InfraModule;
//   R2StorageService via R2StorageModule (KYC presigned docs).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { R2StorageModule } from '../../../infra/cloudflare/r2-storage.module';
import { AdminUserPrismaRepository } from './repositories/admin-user-prisma.repository';
import { AdminUserQueryService } from './services/admin-user-query.service';
import { AdminUserCommandService } from './services/admin-user-command.service';
import { AdminKycProcessorService } from './services/admin-kyc-processor.service';
import { AdminUserRestController } from './controllers/admin-user-rest.controller';
import { AdminUserResolver } from './resolvers/admin-user.resolver';
import { AdminRbacGuard } from './guards/admin-rbac.guard';

@Module({
  imports: [R2StorageModule],
  controllers: [AdminUserRestController],
  providers: [
    AdminUserPrismaRepository,
    AdminUserQueryService,
    AdminUserCommandService,
    AdminKycProcessorService,
    AdminUserResolver,
    AdminRbacGuard,
  ],
  exports: [AdminUserQueryService, AdminUserCommandService, AdminKycProcessorService],
})
export class AdminUserModule {}
