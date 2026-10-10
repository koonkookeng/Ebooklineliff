// SSOT Phase 119 Task 4 §5.1 — device security module wiring
// Canonical: apps/backend/src/modules/security/security.module.ts
// (legacy scaffold class renamed — no importers.)
// - RISK_CALL: class is DeviceSecurityModule (not SecurityModule) —
//   app.module already imports infra/security/security.module.ts (028) under
//   that name. Verifier + eviction + HLS signer + edge repo + guards +
//   controller. Prisma/Redis ride @Global InfraModule. Zero new deps.
// - Phase 120 RISK_CALL (additive-only, documented): the 120 anomaly lane
//   (GeoIp/Velocity/Risk/IpAnomaly/Flex services) registers here because the
//   phase boundary lists the service files but no new module file; the 119
//   providers above are byte-untouched.
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
import { GeoipLookupService } from './services/geoip-lookup.service';
import { VelocityCheckerService } from './services/velocity-checker.service';
import { RiskCalculatorService } from './services/risk-calculator.service';
import { IpAnomalyService } from './services/ip-anomaly.service';
import { LogOnlyFlexDelivery, LineFlexAlertService } from './services/line-flex-alert.service';
import { SecurityResolver } from '../../api/graphql/resolvers/security.resolver';

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
    // ---- Phase 120 additive lane (119 providers above untouched) ----
    GeoipLookupService,
    VelocityCheckerService,
    RiskCalculatorService,
    LogOnlyFlexDelivery,
    LineFlexAlertService,
    {
      provide: IpAnomalyService,
      useFactory: (
        geoIp: GeoipLookupService,
        velocity: VelocityCheckerService,
        risk: RiskCalculatorService,
        alerts: LineFlexAlertService,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) => new IpAnomalyService(geoIp, velocity, risk, alerts, prisma, redis),
      inject: [GeoipLookupService, VelocityCheckerService, RiskCalculatorService, LineFlexAlertService, PrismaService, RedisClusterService],
    },
    {
      provide: SecurityResolver,
      useFactory: (anomaly: IpAnomalyService, sessions: SessionEvictionService) =>
        new SecurityResolver(anomaly, sessions),
      inject: [IpAnomalyService, SessionEvictionService],
    },
  ],
  exports: [FingerprintVerifierService, SessionEvictionService, HlsTokenSignerService, ActiveSessionRedisRepository, DeviceFingerprintGuard, ConcurrentStreamGuard, GeoipLookupService, VelocityCheckerService, RiskCalculatorService, IpAnomalyService, LineFlexAlertService, SecurityResolver],
})
export class DeviceSecurityModule {}
