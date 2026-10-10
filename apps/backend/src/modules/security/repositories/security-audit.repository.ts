// SSOT Phase 120 Task 7 §5.1 — anomaly persistence repository (structural)
// Canonical: apps/backend/src/modules/security/repositories/security-audit.repository.ts
// (legacy src/backend/modules/security/repositories/security-audit.repository.ts)
// - Thin Prisma adapter for login logs / known devices / blacklist /
//   settings. Services stay mock-friendly through this single seam.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

type PrismaAny = {
  userLoginLog: {
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    create(a: unknown): Promise<unknown>;
  };
  knownUserDevice: {
    findFirst(a: unknown): Promise<unknown>;
    upsert(a: unknown): Promise<unknown>;
  };
  securityIpBlacklist: { findFirst(a: unknown): Promise<unknown> };
  userSecuritySetting: { findUnique(a: unknown): Promise<unknown> };
};

@Injectable()
export class SecurityAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  lastLogin(userId: string): Promise<unknown> {
    return this.db.userLoginLog.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  recentLogins(userId: string, since: Date, take = 30): Promise<unknown[]> {
    return this.db.userLoginLog.findMany({ where: { userId, createdAt: { gte: since } }, select: { ipAddress: true, createdAt: true }, take });
  }

  createLoginLog(data: Record<string, unknown>): Promise<unknown> {
    return this.db.userLoginLog.create({ data });
  }

  touchKnownDevice(userId: string, deviceFingerprint: string, ipAddress: string, countryCode: string): Promise<unknown> {
    return this.db.knownUserDevice.upsert({
      where: { userId_deviceFingerprint: { userId, deviceFingerprint } },
      update: { lastSeenAt: new Date(), lastUsedIp: ipAddress, lastUsedCountry: countryCode },
      create: { userId, deviceFingerprint, lastUsedIp: ipAddress, lastUsedCountry: countryCode },
    });
  }

  blacklisted(ipAddress: string): Promise<unknown> {
    return this.db.securityIpBlacklist.findFirst({ where: { ipAddress } });
  }

  settings(userId: string): Promise<unknown> {
    return this.db.userSecuritySetting.findUnique({ where: { userId } });
  }
}
