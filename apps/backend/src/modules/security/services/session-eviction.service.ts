// SSOT Phase 119 Task 4 §5.1/BDD-2+3 — session eviction service
// Canonical: apps/backend/src/modules/security/services/session-eviction.service.ts
// (legacy src/backend/modules/security/services/session-eviction.service.ts)
// - heartbeat: session-token ownership + fingerprint match + grace-aware
//   takeover (stale ≤10s other-holder → evict + take over + SSE signal;
//   live other-holder → deny with activeDeviceId). 2-miss grace (§10) before
//   a same-device gap is treated as dead.
// - revokeAll / lockAccount (BDD-3: sessions → EVICTED/BLOCKED + audit +
//   streams; the 109 freeze executes downstream via `admin.lock.requested`).
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DEVICE_EVENT_STREAM, EVICTION_SLA_MS, HEARTBEAT_GRACE_MISSES, STREAM_STALE_MS, isStreamStale } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { ActiveSessionRedisRepository } from '../repositories/active-session-redis.repository';
import { DeviceNotificationService } from '../device-notify.service';
import { buildDeviceFlex, deviceFlexByteSize, DEVICE_FLEX_BUDGET_BYTES } from '../device-flex.builder';

export interface HeartbeatResult {
  ok: boolean;
  takenOver: boolean;
  evictedDeviceId?: string;
  elapsedMs: number;
}

type PrismaAny = {
  user: { findUnique(a: unknown): Promise<unknown> };
  activeSession: {
    findUnique(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    create(a: unknown): Promise<unknown>;
    update(a: unknown): Promise<unknown>;
    updateMany(a: unknown): Promise<unknown>;
  };
  userDevice: { findUnique(a: unknown): Promise<unknown> };
  securityAuditLog: { create(a: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

@Injectable()
export class SessionEvictionService {
  private readonly logger = new Logger(SessionEvictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly edge: ActiveSessionRedisRepository,
    private readonly notify: DeviceNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(DEVICE_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks session flows.
    }
  }

  private async audit(userId: string | null, eventType: string, fingerprintHash: string | null, ipAddress: string, metadata: Record<string, unknown>): Promise<void> {
    // 106 columns (action/granted) are required — 119 writes action=event,
    // granted=false (all 119 audit writes are restrictive security events).
    await this.db.securityAuditLog.create({
      data: { userId, action: eventType, eventType, fingerprintHash, ipAddress, granted: false, metadata },
    }).catch(() => undefined);
  }

  private async flexTo(userId: string, outcome: 'EVICTED' | 'FRAUD_LOCK', detail?: string): Promise<void> {
    const user = (await this.db.user.findUnique({ where: { id: userId } }).catch(() => null)) as { lineUserId?: string | null } | null;
    // Tenant name is unavailable at this layer — the Flex alt/header carries
    // the verdict; tenant branding resolves at the LINE OA template layer.
    const bubble = buildDeviceFlex({ outcome, tenantName: 'default', ...(detail ? { detail } : {}) });
    if (deviceFlexByteSize(bubble) > DEVICE_FLEX_BUDGET_BYTES) return;
    try {
      await this.notify.notify(user?.lineUserId ?? null, outcome, JSON.stringify(bubble));
    } catch {
      // Notify is fail-open — session state already committed.
    }
  }

  /** Create a streaming session (device must be bound + trusted). */
  async openSession(userId: string, deviceId: string, lessonId: string, ipAddress: string, ttlMinutes = 15): Promise<{ sessionToken: string; expiresAt: string }> {
    const device = (await this.db.userDevice.findUnique({ where: { id: deviceId } }).catch(() => null)) as {
      id: string; userId: string; isTrusted: boolean; fingerprintHash: string;
    } | null;
    if (!device || device.userId !== userId) throw new ForbiddenException('Unknown device binding');
    if (!device.isTrusted) throw new ForbiddenException('Device is not trusted — re-verify first');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000);
    const row = (await this.db.activeSession.create({
      data: { userId, deviceId, activeStreamLessonId: lessonId, sessionStatus: 'ACTIVE_STREAMING', ipAddress, expiresAt },
    })) as { sessionToken: string };
    await this.publish('device.session.opened', { userId, deviceId, lessonId });
    return { sessionToken: row.sessionToken, expiresAt: expiresAt.toISOString() };
  }

  /** 5s heartbeat with stale-aware takeover (BDD-2, <150ms budget). */
  async heartbeat(args: { userId: string; sessionToken: string; fingerprintHash: string; lessonId: string; playbackPositionSec: number; ipAddress: string }): Promise<HeartbeatResult> {
    const startedAt = Date.now();
    const session = (await this.db.activeSession.findUnique({ where: { sessionToken: args.sessionToken } }).catch(() => null)) as {
      id: string; userId: string; deviceId: string; sessionStatus: string;
    } | null;
    if (!session || session.userId !== args.userId) throw new BadRequestException('Unknown stream session');
    if (session.sessionStatus === 'BLOCKED_FRAUD') throw new ForbiddenException('Streaming locked — re-authenticate via OTP');
    // Evicted holders stay evicted (no flap-back): the modal persists until re-handshake.
    if (session.sessionStatus === 'EVICTED_CONCURRENT') {
      throw new ForbiddenException('Session evicted by another device — re-handshake to take over');
    }
    const device = (await this.db.userDevice.findUnique({ where: { id: session.deviceId } }).catch(() => null)) as {
      fingerprintHash: string;
    } | null;
    if (!device || device.fingerprintHash !== args.fingerprintHash) {
      throw new ForbiddenException('Device fingerprint mismatch');
    }

    const pointer = await this.edge.read(args.userId);
    const now = Date.now();
    let takenOver = false;
    let evictedDeviceId: string | undefined;
    if (pointer && pointer.sessionToken && pointer.sessionToken !== args.sessionToken) {
      const lastBeat = Number(pointer.lastHeartbeatTime ?? 0);
      const graceMs = HEARTBEAT_GRACE_MISSES * 5000;
      if (isStreamStale(lastBeat, now, Math.max(STREAM_STALE_MS, graceMs))) {
        // Dead holder — take over silently.
        takenOver = true;
      } else {
        // Live holder elsewhere — evict it, take over, signal within 150ms.
        takenOver = true;
        evictedDeviceId = pointer.deviceId ?? 'unknown-device';
        await this.db.activeSession.updateMany({
          where: { userId: args.userId, sessionToken: pointer.sessionToken },
          data: { sessionStatus: 'EVICTED_CONCURRENT' },
        }).catch(() => undefined);
        await this.audit(args.userId, 'CONCURRENT_STREAM_DETECTED', args.fingerprintHash, args.ipAddress, {
          attemptedLessonId: args.lessonId,
          activeDeviceId: evictedDeviceId,
        });
        await this.publish('device.evicted', { userId: args.userId, evictedDeviceId, bySession: args.sessionToken });
        await this.flexTo(args.userId, 'EVICTED', `อุปกรณ์ ${evictedDeviceId.slice(0, 8)} ถูกเตะออกจากการรับชม`);
      }
    }

    await this.db.activeSession.update({ where: { id: session.id }, data: { lastHeartbeatAt: new Date(), activeStreamLessonId: args.lessonId } }).catch(() => undefined);
    await this.edge.write(args.userId, {
      sessionToken: args.sessionToken,
      fingerprintHash: args.fingerprintHash,
      lessonId: args.lessonId,
      lastHeartbeatTime: String(now),
      ip: args.ipAddress,
      deviceId: session.deviceId,
    });
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > EVICTION_SLA_MS) {
      this.logger.warn(`Heartbeat SLA breach for ${args.userId}: ${elapsedMs}ms`);
    }
    return { ok: true, takenOver, ...(evictedDeviceId ? { evictedDeviceId } : {}), elapsedMs };
  }

  /** Owner's trusted device inventory (newest activity first). */
  async listDevices(userId: string): Promise<Array<Record<string, unknown>>> {
    const rows = (await (this.prisma as unknown as {
      userDevice: { findMany(a: unknown): Promise<unknown[]> };
    }).userDevice.findMany({ where: { userId }, orderBy: { lastActiveAt: 'desc' }, take: 10 }).catch(() => [])) as Array<{
      id: string; deviceName: string; deviceType: string; isTrusted: boolean; lastIpAddress: string; lastActiveAt: Date; fingerprintHash: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      deviceName: r.deviceName,
      deviceType: r.deviceType,
      isTrusted: r.isTrusted,
      lastIpAddress: r.lastIpAddress,
      lastActiveAt: r.lastActiveAt instanceof Date ? r.lastActiveAt.toISOString() : String(r.lastActiveAt),
      fingerprintFragment: String(r.fingerprintHash ?? '').slice(0, 12),
    }));
  }

  /** Owner revokes one device (sessions die with it; edge cleared on match). */
  async revokeDevice(userId: string, deviceId: string): Promise<boolean> {
    const device = (await this.db.userDevice.findUnique({ where: { id: deviceId } }).catch(() => null)) as {
      id: string; userId: string;
    } | null;
    if (!device || device.userId !== userId) throw new ForbiddenException('Unknown device binding');
    await this.db.activeSession.updateMany({ where: { deviceId }, data: { sessionStatus: 'EVICTED_CONCURRENT' } }).catch(() => undefined);
    await (this.prisma as unknown as { userDevice: { delete(a: unknown): Promise<unknown> } }).userDevice.delete({ where: { id: deviceId } }).catch(() => undefined);
    const pointer = await this.edge.read(userId);
    if (pointer?.deviceId === deviceId) await this.edge.clear(userId);
    await this.audit(userId, 'DEVICE_REVOKED', null, 'self', { deviceId });
    await this.publish('device.revoked', { userId, deviceId });
    return true;
  }
  /** Revoke every live session of a user (BDD-3 first half). */
  async revokeAll(userId: string, reason: string): Promise<{ revoked: number }> {
    const rows = (await this.db.activeSession.findMany({ where: { userId, sessionStatus: 'ACTIVE_STREAMING' } }).catch(() => [])) as Array<{ id: string }>;
    await this.db.activeSession.updateMany({ where: { userId, sessionStatus: 'ACTIVE_STREAMING' }, data: { sessionStatus: 'EVICTED_CONCURRENT' } }).catch(() => undefined);
    await this.edge.clear(userId);
    await this.audit(userId, reason, null, 'system', { revoked: rows.length });
    await this.publish('device.sessions.revoked', { userId, revoked: rows.length, reason });
    return { revoked: rows.length };
  }

  /** BDD-3 lock: revoke + BLOCKED_FRAUD + 109-freeze handoff + Flex stream. */
  async lockAccount(userId: string, fingerprintHash: string | null, ipAddress: string, fraudScore: number): Promise<boolean> {
    await this.revokeAll(userId, 'ACCOUNT_LOCK');
    await this.db.activeSession.updateMany({ where: { userId }, data: { sessionStatus: 'BLOCKED_FRAUD' } }).catch(() => undefined);
    await this.audit(userId, 'ACCOUNT_LOCK', fingerprintHash, ipAddress, { fraudScore });
    await this.flexTo(userId, 'FRAUD_LOCK', `คะแนนความเสี่ยง ${fraudScore} — ยืนยัน OTP เพื่อปลดล็อก`);
    try {
      await this.redis.xaddPipeline(DEVICE_EVENT_STREAM, [{ event: 'device.account.locked', userId, fraudScore, at: Date.now() }]);
      await this.redis.xaddPipeline('stream:admin:lock', [{ event: 'admin.lock.requested', userId, reason: 'device-fraud', at: Date.now() }]);
    } catch {
      // Telemetry never breaks the lock path.
    }
    return true;
  }
}
