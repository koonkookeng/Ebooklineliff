// SSOT Phase 120 Task 7 §5.2 — IP anomaly orchestrator (login verdicts)
// Canonical: apps/backend/src/modules/security/services/ip-anomaly.service.ts
// (legacy src/backend/modules/security/services/ip-anomaly.service.ts)
// - Flow (BDD-1 <500ms): XFF-spoof gate -> GeoIP resolve (cached <2ms) ->
//   last-login fix -> velocity verdict -> blacklist + known-device reads ->
//   risk evaluate -> UserLoginLog row (Gate 7: single create, no core-table
//   writes) -> known-device touch -> HIGH/CRITICAL Flex + stream (fail-open).
//   Settings row gates alerts per user (defaults allow).
// - Auth/token revocation for BDD-2 rides `auth.token.revoke` stream for the
//   auth lane (Zero Redundant — no token tables here).
// - Zero new deps.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SECURITY_ALERT_BUDGET_MS, SECURITY_ALERT_STREAM, isIpLiteral } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { GeoipLookupService } from './geoip-lookup.service';
import { VelocityCheckerService, rotationScreen } from './velocity-checker.service';
import { RiskCalculatorService } from './risk-calculator.service';
import { LineFlexAlertService } from './line-flex-alert.service';

export interface LoginVerdict {
  actionRequired: 'ALLOW' | 'REQUIRE_MFA' | 'BLOCK';
  riskScore: number;
  riskLevel: string;
  anomalyType: string;
  logId: string;
  elapsedMs: number;
}

type PrismaAny = {
  user: { findUnique(a: unknown): Promise<unknown> };
  userLoginLog: {
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    create(a: unknown): Promise<unknown>;
  };
  knownUserDevice: { findFirst(a: unknown): Promise<unknown>; upsert(a: unknown): Promise<unknown> };
  securityIpBlacklist: { findFirst(a: unknown): Promise<unknown> };
  userSecuritySetting: { findUnique(a: unknown): Promise<unknown> };
};

@Injectable()
export class IpAnomalyService {
  private readonly logger = new Logger(IpAnomalyService.name);

  constructor(
    private readonly geoIp: GeoipLookupService,
    private readonly velocity: VelocityCheckerService,
    private readonly risk: RiskCalculatorService,
    private readonly alerts: LineFlexAlertService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(SECURITY_ALERT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks login flows.
    }
  }

  /** Owner-scoped login history (latest first, bounded). */
  async recentLogins(userId: string, take = 20): Promise<Record<string, unknown>[]> {
    const rows = (await (this.prisma as unknown as {
      userLoginLog: { findMany(a: unknown): Promise<unknown[]> };
    }).userLoginLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, take)),
    }).catch(() => [])) as Record<string, unknown>[];
    return rows;
  }

  /** Admin queue: non-NORMAL verdicts, latest first (bounded). */
  async flaggedLogins(skip: number, take: number): Promise<Record<string, unknown>[]> {
    const rows = (await (this.prisma as unknown as {
      userLoginLog: { findMany(a: unknown): Promise<unknown[]> };
    }).userLoginLog.findMany({
      where: { anomalyType: { not: 'NORMAL' } },
      orderBy: { createdAt: 'desc' },
      skip: Math.max(0, skip),
      take: Math.min(100, Math.max(1, take)),
    }).catch(() => [])) as Record<string, unknown>[];
    return rows;
  }
  static extractClientIp(xForwardedFor: string | undefined, socketIp: string | undefined): string {
    const raw = (xForwardedFor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const ip of raw) {
      if (isIpLiteral(ip) && !ip.startsWith('10.') && ip !== '127.0.0.1' && ip !== '::1') return ip;
    }
    const fallback = (socketIp ?? '').trim();
    if (fallback && isIpLiteral(fallback)) return fallback;
    throw new BadRequestException('Unresolvable client IP');
  }

  async processLoginEvent(args: { userId: string; ipAddress: string; userAgent: string; deviceFingerprint: string; tenantName?: string }): Promise<LoginVerdict> {
    const startedAt = Date.now();
    if (!args.userId) throw new BadRequestException('Missing userId');
    if (!isIpLiteral(args.ipAddress)) throw new BadRequestException('Invalid IP literal');

    const [currentGeo, lastLogin, listed, knownDevice, settings] = await Promise.all([
      this.geoIp.resolveIp(args.ipAddress),
      this.db.userLoginLog.findFirst({ where: { userId: args.userId }, orderBy: { createdAt: 'desc' } }).catch(() => null),
      this.db.securityIpBlacklist.findFirst({ where: { ipAddress: args.ipAddress } }).catch(() => null),
      this.db.knownUserDevice.findFirst({ where: { userId: args.userId, deviceFingerprint: args.deviceFingerprint } }).catch(() => null),
      this.db.userSecuritySetting.findUnique({ where: { userId: args.userId } }).catch(() => null),
    ]);
    const blacklisted = listed && (!(listed as { expiresAt?: Date | string | null }).expiresAt ||
      new Date((listed as { expiresAt: Date | string }).expiresAt) > new Date())
      ? listed
      : null;
    const last = lastLogin as { latitude: number | null; longitude: number | null; createdAt: Date; countryCode: string | null } | null;

    const velocity = this.velocity.calculate(
      last ? { latitude: last.latitude, longitude: last.longitude, at: last.createdAt } : null,
      { latitude: currentGeo.latitude, longitude: currentGeo.longitude },
      Date.now(),
    );
    const recentWindow = (await this.db.userLoginLog.findMany({
      where: { userId: args.userId, createdAt: { gte: new Date(Date.now() - 30000) } },
      select: { ipAddress: true, createdAt: true },
      take: 30,
    }).catch(() => [])) as Array<{ ipAddress: string; createdAt: Date }>;
    const rotation = rotationScreen(recentWindow.map((r) => ({ ip: r.ipAddress, at: new Date(r.createdAt).getTime() })), Date.now());

    const evaluation = this.risk.evaluate({
      impossibleTravel: velocity.impossible,
      knownVpnProxy: currentGeo.isProxyOrVpn || !!blacklisted,
      highVelocityRotation: rotation.tripped,
      newCountry: !!last?.countryCode && last.countryCode !== currentGeo.countryCode,
      deviceMismatch: !knownDevice,
    });

    const row = (await this.db.userLoginLog.create({
      data: {
        userId: args.userId,
        ipAddress: args.ipAddress,
        country: currentGeo.country,
        countryCode: currentGeo.countryCode,
        region: currentGeo.region,
        city: currentGeo.city,
        latitude: currentGeo.latitude,
        longitude: currentGeo.longitude,
        isp: currentGeo.isp,
        userAgent: args.userAgent,
        deviceFingerprint: args.deviceFingerprint,
        isVpnProxy: currentGeo.isProxyOrVpn,
        riskScore: evaluation.riskScore,
        riskLevel: evaluation.riskLevel,
        anomalyType: evaluation.anomalyType,
        isMfaChallenged: evaluation.mfaRequired,
        isSessionBlocked: evaluation.sessionBlocked,
      },
    })) as { id: string };

    await this.db.knownUserDevice.upsert({
      where: { userId_deviceFingerprint: { userId: args.userId, deviceFingerprint: args.deviceFingerprint } },
      update: { lastSeenAt: new Date(), lastUsedIp: args.ipAddress, lastUsedCountry: currentGeo.countryCode },
      create: { userId: args.userId, deviceFingerprint: args.deviceFingerprint, lastUsedIp: args.ipAddress, lastUsedCountry: currentGeo.countryCode },
    }).catch(() => undefined);

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > SECURITY_ALERT_BUDGET_MS) {
      this.logger.warn(`Anomaly pipeline SLA breach for ${args.userId}: ${elapsedMs}ms`);
    }
    const alertsOn = (settings as { enableGeoAlerts?: boolean; enableLineFlexAlerts?: boolean } | null)?.enableGeoAlerts !== false &&
      (settings as { enableLineFlexAlerts?: boolean } | null)?.enableLineFlexAlerts !== false;
    if (alertsOn && (evaluation.riskLevel === 'HIGH' || evaluation.riskLevel === 'CRITICAL')) {
      const user = (await this.db.user.findUnique({ where: { id: args.userId } }).catch(() => null)) as {
        lineUserId?: string | null;
      } | null;
      if (user?.lineUserId) {
        await this.alerts.sendSecurityAlertCard({
          lineUserId: user.lineUserId,
          title: '⚠️ มีการเข้าสู่ระบบจากพิกัดผิดปกติ',
          location: `${currentGeo.city}, ${currentGeo.country}`,
          ipAddress: args.ipAddress,
          device: args.userAgent,
          riskLevel: evaluation.riskLevel,
          timestamp: new Date().toISOString(),
        }).catch(() => undefined);
      }
    }
    if (rotation.tripped) {
      await this.publish('auth.token.revoke', { userId: args.userId, reason: 'HIGH_VELOCITY_IP_ROTATION' });
    }
    await this.publish('anomaly.scored', {
      userId: args.userId,
      logId: row.id,
      anomalyType: evaluation.anomalyType,
      riskScore: evaluation.riskScore,
      elapsedMs,
    });
    return {
      actionRequired: evaluation.sessionBlocked ? 'BLOCK' : evaluation.mfaRequired ? 'REQUIRE_MFA' : 'ALLOW',
      riskScore: evaluation.riskScore,
      riskLevel: evaluation.riskLevel,
      anomalyType: evaluation.anomalyType,
      logId: row.id,
      elapsedMs,
    };
  }
}
