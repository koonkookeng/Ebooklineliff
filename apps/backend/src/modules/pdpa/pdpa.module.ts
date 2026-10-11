// SSOT Phase 129 §5 — PDPA module wiring
// Canonical: apps/backend/src/modules/pdpa/pdpa.module.ts
// (legacy src/backend/modules/pdpa/*)
// - useFactory wiring keeps services tsx-importable (050/124 precedent).
//   PrismaService + RedisClusterService arrive via global InfraModule.
//   FieldEncryptionService is constructed with env defaults (identical to
//   PiiModule behavior, no cross-module import).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { ConsentManagerService } from './services/consent-manager.service';
import { DsrEngineService } from './services/dsr-engine.service';
import { PdpaController } from './pdpa.controller';
import { PdpaResolver } from './pdpa.resolver';
import { PiiCryptoService } from '../security/services/pii-crypto.service';
import { AuditLoggerService } from '../security/services/audit-logger.service';
import { PdpaConsentGuard } from '../security/guards/pdpa-consent.guard';

@Module({
  controllers: [PdpaController],
  providers: [
    {
      provide: ConsentManagerService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        new ConsentManagerService(prisma as never, redis as never),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: DsrEngineService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        new DsrEngineService(prisma as never, {
          revokeSessions: async (userId: string) => {
            try {
              const keys = await (redis as never as { scanKeys(p: string): Promise<string[]> }).scanKeys(
                `session:*{${userId}}*`,
              );
              if (keys.length > 0) await (redis as never as { del(...k: string[]): Promise<void> }).del(...keys);
              return keys.length;
            } catch {
              return 0;
            }
          },
          revokeEntitlements: async (userId: string) => {
            try {
              const keys = await (redis as never as { scanKeys(p: string): Promise<string[]> }).scanKeys(
                `entitlement:{${userId}}*`,
              );
              if (keys.length > 0) await (redis as never as { del(...k: string[]): Promise<void> }).del(...keys);
              return keys.length;
            } catch {
              return 0;
            }
          },
          del: async (...keys: string[]) => {
            await (redis as never as { del(...k: string[]): Promise<void> }).del(...keys).catch(() => undefined);
          },
        }),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: PiiCryptoService,
      useFactory: () => new PiiCryptoService(new FieldEncryptionService()),
      inject: [],
    },
    {
      provide: AuditLoggerService,
      useFactory: (prisma: PrismaService) => new AuditLoggerService(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: PdpaResolver,
      useFactory: (consents: ConsentManagerService, dsr: DsrEngineService) =>
        new PdpaResolver(consents, dsr),
      inject: [ConsentManagerService, DsrEngineService],
    },
    {
      provide: PdpaConsentGuard,
      useFactory: (consents: ConsentManagerService) => new PdpaConsentGuard(consents),
      inject: [ConsentManagerService],
    },
  ],
  exports: [ConsentManagerService, DsrEngineService, PiiCryptoService, AuditLoggerService, PdpaConsentGuard],
})
export class PdpaModule {}
