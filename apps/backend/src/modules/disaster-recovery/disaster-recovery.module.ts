// SSOT Phase 127 §5/§8.2 — disaster recovery module wiring
// Canonical: apps/backend/src/modules/disaster-recovery/disaster-recovery.module.ts
// (legacy src/backend/modules/disaster-recovery/*)
// - useFactory wiring keeps services tsx-importable (050/124 precedent).
//   PrismaService + RedisClusterService arrive via global InfraModule;
//   R2StorageService exposes putObjectBuffer/getObjectBuffer (036 surface).
// - Failover ports are env-driven shells here (real promotion/DNS lives in
//   infra/scripts/dr-failover.sh §6.2); the service still ledgers + measures
//   RTO so drills stay honest. Cores untouched. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { HealthCheckerService } from './services/health-checker.service';
import { AutomatedFailoverService } from './services/automated-failover.service';
import { R2PitrBackupService } from './services/r2-pitr-backup.service';
import { BackupVerifierJob } from './cron/backup-verifier.job';

@Module({
  providers: [
    {
      provide: HealthCheckerService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        new HealthCheckerService(prisma as never, redis as never),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: AutomatedFailoverService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) =>
        new AutomatedFailoverService({
          probePrimary: async () => {
            const raw = await (redis as never as { get(k: string): Promise<string | null> }).get('dr:primary:heartbeat').catch(() => null);
            return raw !== null;
          },
          promoteStandby: async () => process.env.DR_STANDBY_HOST ?? 'db-standby-asia.omnichannel.internal',
          rerouteEndpoint: async () => undefined,
          flushEdgeCache: async () => {
            await (redis as never as { del(...k: string[]): Promise<void> }).del('dr:primary:heartbeat').catch(() => undefined);
          },
          broadcast: async () => undefined,
          ledgerFailover: async (row) => {
            await (prisma as never as { disasterRecoverySnapshot: { create(a: unknown): Promise<unknown> } }).disasterRecoverySnapshot
              .create({ data: { snapshotId: `failover-${Date.now()}`, backupType: row.backupType, r2StoragePath: row.detail, fileSizeBytes: BigInt(0), checksumSha256: 'failover-marker' } })
              .catch(() => undefined);
          },
        }),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: R2PitrBackupService,
      useFactory: (vault: R2StorageService, prisma: PrismaService) =>
        new R2PitrBackupService(vault as never, prisma as never),
      inject: [R2StorageService, PrismaService],
    },
    {
      provide: BackupVerifierJob,
      useFactory: (vault: R2StorageService, prisma: PrismaService) =>
        new BackupVerifierJob(vault as never, prisma as never),
      inject: [R2StorageService, PrismaService],
    },
  ],
  exports: [HealthCheckerService, AutomatedFailoverService, R2PitrBackupService, BackupVerifierJob],
})
export class DisasterRecoveryModule {}
