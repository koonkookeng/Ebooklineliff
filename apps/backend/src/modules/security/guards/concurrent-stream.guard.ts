// SSOT Phase 119 Task 4 §5.2 — concurrent stream guard (edge takeover)
// Canonical: apps/backend/src/modules/security/guards/concurrent-stream.guard.ts
// (legacy src/backend/modules/security/guards/concurrent-stream.guard.ts)
// - Adapts the spec §5.2 guard to the real RedisClusterService surface
//   (hgetall/hset/expire — no hmset port exists): stale other-holder
//   (≥10s) → silent takeover; live other-holder → evict + audit + deny
//   with CONCURRENT_STREAM_DENIED (<150ms budget); empty → register.
//   Fail-open to registration on Redis outage (availability wins; the DB
//   session row stays the durable guard).
// - Zero new deps.
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { EVICTION_SLA_MS, STREAM_HASH_TTL_SEC, STREAM_STALE_MS, activeStreamKey } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

type LooseReq = Record<string, unknown>;

@Injectable()
export class ConcurrentStreamGuard implements CanActivate {
  private readonly logger = new Logger(ConcurrentStreamGuard.name);

  constructor(
    private readonly redis: RedisClusterService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const startedAt = Date.now();
    const req = context.switchToHttp().getRequest<LooseReq>();
    const user = (req['user'] as { id?: string } | undefined) ?? {};
    const body = (req['body'] ?? {}) as { lessonId?: string; fingerprintHash?: string; sessionToken?: string };
    const { lessonId, fingerprintHash, sessionToken } = body;
    if (!user.id || !fingerprintHash || !sessionToken) {
      throw new UnauthorizedException('Security Context Missing');
    }
    const key = activeStreamKey(user.id);
    let existing: Record<string, string> | null = null;
    try {
      existing = await this.redis.hgetall(key);
    } catch (err) {
      this.logger.warn(`Concurrent guard fail-open for ${user.id}: ${(err as Error).message}`);
    }
    if (existing && existing['sessionToken'] && existing['sessionToken'] !== sessionToken) {
      const lastBeat = Number(existing['lastHeartbeatTime'] ?? 0);
      if (Date.now() - lastBeat < STREAM_STALE_MS) {
        const db = this.prisma as unknown as {
          securityAuditLog: { create(a: unknown): Promise<unknown> };
          activeSession: { updateMany(a: unknown): Promise<unknown> };
        };
        await db.securityAuditLog.create({
          data: {
            userId: user.id,
            action: 'CONCURRENT_STREAM',
            eventType: 'CONCURRENT_STREAM_DETECTED',
            fingerprintHash,
            ipAddress: ((req['ip'] as string | undefined) ?? '0.0.0.0'),
            granted: false,
            metadata: { attemptedLessonId: lessonId ?? null, activeDeviceId: existing['deviceId'] ?? null },
          },
        }).catch(() => undefined);
        await db.activeSession.updateMany({
          where: { userId: user.id, sessionToken: existing['sessionToken'] },
          data: { sessionStatus: 'EVICTED_CONCURRENT' },
        }).catch(() => undefined);
        throw new UnauthorizedException({
          errorCode: 'CONCURRENT_STREAM_DENIED',
          message: 'บัญชีนี้กำลังรับชมวิดีโออยู่บนอุปกรณ์อื่น',
          activeDeviceId: existing['deviceId'] ?? null,
        });
      }
    }
    try {
      await this.redis.hset(key, {
        sessionToken,
        fingerprintHash,
        lessonId: lessonId ?? '',
        lastHeartbeatTime: String(Date.now()),
        ip: ((req['ip'] as string | undefined) ?? '0.0.0.0'),
      });
      await this.redis.expire(key, STREAM_HASH_TTL_SEC);
    } catch (err) {
      this.logger.warn(`Stream pointer write failed for ${user.id}: ${(err as Error).message}`);
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > EVICTION_SLA_MS) {
      this.logger.warn(`Concurrent guard SLA breach for ${user.id}: ${elapsedMs}ms`);
    }
    return true;
  }
}
