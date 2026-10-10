// SSOT Phase 119 Task 4 §5.1 — device security module wiring
// Canonical: apps/backend/src/modules/security/security.module.ts
// (legacy scaffold class renamed — no importers.)
// - RISK_CALL: class is DeviceSecurityModule (not SecurityModule) —
//   app.module already imports infra/security/security.module.ts (028) under
//   that name. Verifier + eviction + HLS signer + edge repo + guards +
//   controller. Prisma/Redis ride @Global InfraModule. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { FingerprintVerifierService } from './services/fingerprint-verifier.service';
import { SessionEvictionService } from './services/session-eviction.service';
import { HlsTokenSignerService } from './services/hls-token-signer.service';
import { ActiveSessionRedisRepository } from './repositories/active-session-redis.repository';
import { LogOnlyDeviceNotify, DeviceNotificationService } from './device-notify.service';
import { DeviceFingerprintGuard } from './guards/device-fingerprint.guard';
import { ConcurrentStreamGuard } from './guards/concurrent-stream.guard';
import { SecurityFingerprintController } from './controllers/security-fingerprint.controller';

@Module({
  controllers: [SecurityFingerprintController],
  providers: [
    {
      provide: ActiveSessionRedisRepository,
      useFactory: (redis: RedisClusterService) => new ActiveSessionRedisRepository(redis),
      inject: [RedisClusterService],
    },
    LogOnlyDeviceNotify,
    DeviceNotificationService,
    {
      provide: HlsTokenSignerService,
      useFactory: () => new HlsTokenSignerService(),
      inject: [],
    },
    {
      provide: FingerprintVerifierService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) => new FingerprintVerifierService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: SessionEvictionService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        edge: ActiveSessionRedisRepository,
        notify: DeviceNotificationService,
      ) => new SessionEvictionService(prisma, redis, edge, notify),
      inject: [PrismaService, RedisClusterService, ActiveSessionRedisRepository, DeviceNotificationService],
    },
    {
      provide: DeviceFingerprintGuard,
      useFactory: (verifier: FingerprintVerifierService, sessions: SessionEvictionService) =>
        new DeviceFingerprintGuard(verifier, sessions),
      inject: [FingerprintVerifierService, SessionEvictionService],
    },
    {
      provide: ConcurrentStreamGuard,
      useFactory: (redis: RedisClusterService, prisma: PrismaService) => new ConcurrentStreamGuard(redis, prisma),
      inject: [RedisClusterService, PrismaService],
    },
  ],
  exports: [FingerprintVerifierService, SessionEvictionService, HlsTokenSignerService, ActiveSessionRedisRepository, DeviceFingerprintGuard, ConcurrentStreamGuard],
})
export class DeviceSecurityModule {}
