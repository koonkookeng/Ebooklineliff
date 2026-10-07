// SSOT Phase 030 §4.2 — Tenant theme edge cache (24h TTL + invalidation)
// Canonical: apps/backend/src/modules/tenant/infrastructure/cache/tenant-redis.cache.ts
// (legacy src/backend/modules/tenant/infrastructure/cache/tenant-redis.cache.ts)
// - Key tenant:theme:{slug}, TTL 86400; corrupt entries self-heal (miss path).
// - Fail-open reads (null) so edge outage degrades to DB, never 500s theme.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import { TENANT_THEME_TTL_SEC, tenantThemeKey } from '@repo/shared';

@Injectable()
export class TenantThemeCache {
  constructor(private readonly redis: RedisClusterService) {}

  key(slug: string): string {
    return tenantThemeKey(slug);
  }

  async get(slug: string): Promise<string | null> {
    return this.redis.get(this.key(slug)).catch(() => null);
  }

  async set(slug: string, brandingJson: string): Promise<void> {
    await this.redis.setex(this.key(slug), TENANT_THEME_TTL_SEC, brandingJson).catch(() => undefined);
  }

  async del(slug: string): Promise<void> {
    await this.redis.del(this.key(slug)).catch(() => undefined);
  }
}
