// SSOT Phase 119 Task 4 §5.1 — active-stream Redis repository (edge pointer)
// Canonical: apps/backend/src/modules/security/repositories/active-session-redis.repository.ts
// (legacy src/backend/modules/security/repositories/active-session-redis.repository.ts)
// - One hash per user (`active_stream:<userId>`): sessionToken +
//   fingerprintHash + lessonId + lastHeartbeatTime + ip, 15s TTL (§5.2).
//   All ops fail-open with null/false so guards degrade to DB reads.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { STREAM_HASH_TTL_SEC, activeStreamKey } from '@repo/shared';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

export interface StreamPointer {
  sessionToken: string;
  fingerprintHash: string;
  lessonId: string;
  lastHeartbeatTime: string;
  ip: string;
  deviceId?: string;
}

@Injectable()
export class ActiveSessionRedisRepository {
  private readonly logger = new Logger(ActiveSessionRedisRepository.name);

  constructor(private readonly redis: RedisClusterService) {}

  async read(userId: string): Promise<StreamPointer | null> {
    try {
      const raw = await this.redis.hgetall(activeStreamKey(userId));
      if (!raw || !raw['sessionToken']) return null;
      return {
        sessionToken: raw['sessionToken'] ?? '',
        fingerprintHash: raw['fingerprintHash'] ?? '',
        lessonId: raw['lessonId'] ?? '',
        lastHeartbeatTime: raw['lastHeartbeatTime'] ?? '0',
        ip: raw['ip'] ?? '',
        ...(raw['deviceId'] ? { deviceId: raw['deviceId'] } : {}),
      };
    } catch (err) {
      this.logger.warn(`Stream pointer read fail-open for ${userId}: ${(err as Error).message}`);
      return null;
    }
  }

  async write(userId: string, pointer: StreamPointer, ttlSec = STREAM_HASH_TTL_SEC): Promise<void> {
    try {
      await this.redis.hset(activeStreamKey(userId), {
        sessionToken: pointer.sessionToken,
        fingerprintHash: pointer.fingerprintHash,
        lessonId: pointer.lessonId,
        lastHeartbeatTime: pointer.lastHeartbeatTime,
        ip: pointer.ip,
        ...(pointer.deviceId ? { deviceId: pointer.deviceId } : {}),
      } as Record<string, string>);
      await this.redis.expire(activeStreamKey(userId), ttlSec);
    } catch (err) {
      this.logger.warn(`Stream pointer write failed for ${userId}: ${(err as Error).message}`);
    }
  }

  async clear(userId: string): Promise<void> {
    try {
      await this.redis.del(activeStreamKey(userId));
    } catch {
      // Best-effort (TTL bounds the blast radius).
    }
  }
}
