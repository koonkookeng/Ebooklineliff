// SSOT Phase 018 §5 — Library Redis edge-cache repository (payload + gate flags)
// Canonical: apps/backend/src/modules/library/repositories/library-cache.repository.ts
// (legacy src/backend/modules/library/repositories/library-cache.repository.ts)
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  LIBRARY_CACHE_TTL_SEC,
  MyLibraryPayloadSchema,
  libraryCacheKey,
  libraryGateKey,
  type MyLibraryPayload,
  type MyLibraryQueryInput,
} from '@repo/shared';

/** Gate-flag TTL: 1h (matches entitlement flag cache convention). */
const GATE_TTL_SEC = 3600;

@Injectable()
export class LibraryCacheRepository {
  constructor(private readonly redis: RedisClusterService) {}

  keyFor(userId: string, input: MyLibraryQueryInput): string {
    return libraryCacheKey(userId, input);
  }

  /** Cache hit returns a validated payload; drift/corruption counts as a miss. */
  async getPayload(userId: string, input: MyLibraryQueryInput): Promise<MyLibraryPayload | null> {
    const raw = await this.redis.get(this.keyFor(userId, input)).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = MyLibraryPayloadSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async setPayload(userId: string, input: MyLibraryQueryInput, payload: MyLibraryPayload): Promise<void> {
    await this.redis.setex(this.keyFor(userId, input), LIBRARY_CACHE_TTL_SEC, JSON.stringify(payload)).catch(() => undefined);
  }

  /** 1ms gatekeeper read: cached TRUE flag for an owned product. */
  async checkGate(userId: string, productId: string): Promise<boolean> {
    const hit = await this.redis.get(libraryGateKey(userId, productId)).catch(() => null);
    return hit === 'TRUE';
  }

  async setGate(userId: string, productId: string): Promise<void> {
    await this.redis.setex(libraryGateKey(userId, productId), GATE_TTL_SEC, 'TRUE').catch(() => undefined);
  }
}
