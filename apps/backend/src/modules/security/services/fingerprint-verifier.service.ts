// SSOT Phase 119 Task 4 §5.1/BDD-1+3 — fingerprint verifier service
// Canonical: apps/backend/src/modules/security/services/fingerprint-verifier.service.ts
// (legacy src/backend/modules/security/services/fingerprint-verifier.service.ts)
// - Zod gate -> server-side SHA-256 combine (canonical of the LIFF collector
//   lane) -> register-or-touch device (plan cap 2, oldest-first eviction is
//   explicit via revoke, never silent) -> fraud screen (5 prints/hour,
//   teleport input, 24h swap) with LOCK verdict at >85.
// - Pure combine() exported for DB-free tests. Zero new deps (node:crypto).
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  DEVICE_EVENT_STREAM,
  DEVICE_PLAN_LIMIT,
  DeviceFingerprintPayloadSchema,
  fraudLockVerdict,
  fraudScore,
  withinDeviceLimit,
} from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

export interface DeviceVerifyResult {
  deviceId: string;
  fingerprintHash: string;
  trusted: boolean;
  isNew: boolean;
  fraud: { score: number; verdict: 'ALLOW' | 'LOCK' };
}

/** Server-side canonical combine (mirrors the LIFF collector lane). */
export function combineFingerprint(args: {
  canvasHash: string;
  webglHash: string;
  audioHash: string;
  userAgent: string;
  screenResolution: string;
  lineUserIdHash?: string;
}): string {
  const combined = `${args.canvasHash}:${args.webglHash}:${args.audioHash}:${args.userAgent}:${args.screenResolution}:${args.lineUserIdHash ?? ''}`;
  return createHash('sha256').update(combined, 'utf8').digest('hex');
}

type PrismaAny = {
  userDevice: {
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    count(a: unknown): Promise<number>;
    create(a: unknown): Promise<unknown>;
    update(a: unknown): Promise<unknown>;
  };
};

@Injectable()
export class FingerprintVerifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(DEVICE_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks verification flows.
    }
  }

  /**
   * Verify + bind a device (BDD-1). Teleport inputs are optional edge hints
   * (GeoIP lane feeds them; default 0 keeps unit behavior deterministic).
   */
  async verifyAndBind(
    userId: string,
    input: unknown,
    net: { ipAddress: string; deviceName?: string; teleportKm?: number; teleportMinutes?: number },
  ): Promise<DeviceVerifyResult> {
    const parsed = DeviceFingerprintPayloadSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid device fingerprint payload');
    const fp = parsed.data;
    const fingerprintHash = combineFingerprint({
      canvasHash: fp.canvasHash,
      webglHash: fp.webglHash,
      audioHash: fp.audioHash,
      userAgent: fp.userAgent,
      screenResolution: fp.screenResolution,
      ...(fp.lineUserIdHash ? { lineUserIdHash: fp.lineUserIdHash } : {}),
    });

    const existing = (await this.db.userDevice.findFirst({ where: { userId, fingerprintHash } }).catch(() => null)) as {
      id: string; isTrusted: boolean;
    } | null;
    if (existing) {
      await this.db.userDevice.update({ where: { id: existing.id }, data: { lastIpAddress: net.ipAddress } }).catch(() => undefined);
      await this.publish('device.seen', { userId, deviceId: existing.id });
      return { deviceId: existing.id, fingerprintHash, trusted: existing.isTrusted, isNew: false, fraud: { score: 0, verdict: 'ALLOW' } };
    }

    const [registered, recentPrints, active24h] = await Promise.all([
      this.db.userDevice.count({ where: { userId } }).catch(() => 0),
      this.db.userDevice.count({ where: { userId, registeredAt: { gte: new Date(Date.now() - 3600000) } } }).catch(() => 0),
      this.db.userDevice.count({ where: { userId, lastActiveAt: { gte: new Date(Date.now() - 86400000) } } }).catch(() => 0),
    ]);
    if (!withinDeviceLimit(registered, DEVICE_PLAN_LIMIT)) {
      throw new ForbiddenException('Device limit reached for your plan (max 2) — revoke an old device first');
    }

    const score = fraudScore({
      teleportKm: net.teleportKm ?? 0,
      teleportMinutes: net.teleportMinutes ?? 0,
      uniqueDevices24h: active24h,
      distinctFingerprints1h: recentPrints + 1,
    });
    const verdict = fraudLockVerdict(score);
    const created = (await this.db.userDevice.create({
      data: {
        userId,
        fingerprintHash,
        deviceName: net.deviceName ?? `${fp.deviceType} device`,
        deviceType: fp.deviceType,
        isTrusted: verdict === 'ALLOW',
        lastIpAddress: net.ipAddress,
      },
    })) as { id: string };
    await this.publish('device.bound', { userId, deviceId: created.id, fraudScore: score, verdict });
    return { deviceId: created.id, fingerprintHash, trusted: verdict === 'ALLOW', isNew: true, fraud: { score, verdict } };
  }
}
