// SSOT Phase 118 Task 3 §5.1 — audit module wiring
// Canonical: apps/backend/src/modules/audit-log/audit-log.module.ts
// (no legacy class — this module is new in 118; 109 writers untouched.)
// - Domain engines (pure) + create-only repo + append service + interceptor
//   + daily cron + WORM adapter + REST + GQL. Prisma/Redis ride @Global
//   InfraModule; R2 via R2StorageModule. Zero new deps.
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { HashChainEngine } from './domain/hash-chain.engine';
import { CryptoSignerEngine } from './domain/crypto-signer.engine';
import { AuditLogRepository } from './infrastructure/audit-log.repository';
import { R2WormVaultAdapter } from './infrastructure/r2-worm-vault.adapter';
import { LogOnlyAuditNotify, AuditNotificationService } from './application/audit-notify.service';
import { AuditLogService } from './application/audit-log.service';
import { AuditInterceptor } from './application/audit-interceptor';
import { IntegrityCheckerCron } from './application/integrity-checker.cron';
import { AuditLogController } from './presentation/audit-log.controller';
import { AuditLogResolver } from './presentation/audit-log.resolver';

@Module({
  imports: [R2StorageModule],
  controllers: [AuditLogController],
  providers: [
    HashChainEngine,
    {
      provide: CryptoSignerEngine,
      useFactory: () => new CryptoSignerEngine(),
      inject: [],
    },
    AuditLogRepository,
    {
      provide: R2WormVaultAdapter,
      useFactory: (r2: R2StorageService) => new R2WormVaultAdapter(r2),
      inject: [R2StorageService],
    },
    LogOnlyAuditNotify,
    AuditNotificationService,
    {
      provide: AuditLogService,
      useFactory: (redis: RedisClusterService, repo: AuditLogRepository, signer: CryptoSignerEngine) =>
        new AuditLogService(redis, repo, signer),
      inject: [RedisClusterService, AuditLogRepository, CryptoSignerEngine],
    },
    {
      provide: AuditInterceptor,
      useFactory: (audit: AuditLogService) => new AuditInterceptor(audit),
      inject: [AuditLogService],
    },
    {
      provide: IntegrityCheckerCron,
      useFactory: (audit: AuditLogService, redis: RedisClusterService, notify: AuditNotificationService) =>
        new IntegrityCheckerCron(audit, redis, notify),
      inject: [AuditLogService, RedisClusterService, AuditNotificationService],
    },
    {
      provide: AuditLogResolver,
      useFactory: (audit: AuditLogService) => new AuditLogResolver(audit),
      inject: [AuditLogService],
    },
  ],
  exports: [AuditLogService, AuditInterceptor, AuditLogRepository, HashChainEngine, CryptoSignerEngine, IntegrityCheckerCron],
})
export class AuditLogModule {}
