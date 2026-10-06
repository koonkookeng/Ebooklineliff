// SSOT Phase 025 §5.2 — Deep-link resolution & HMAC verification service core
// Canonical: apps/backend/src/modules/resolver/application/services/deep-link-resolver.service.ts
// (legacy src/backend/modules/resolver/ — §5.2 DeepLinkResolverService)
// - Zero new deps: Prisma (via repository) + RedisClusterService (get/setex/publish).
// - Latency budget §10.1 (<300ms): Redis-first (100% cache-hit target, 24h TTL);
//   DB fallback re-caches. Click logging is non-blocking (Gate 7: attribution <50ms
//   uses fire-and-forget with silent catch; never fails the redirect path).
// - Fraud guard (Gate 4): HMAC-SHA256 via HmacCryptoService, timing-safe compare.
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { HmacCryptoService } from '../../domain/services/hmac-crypto.service';
import {
  assertResolvable,
  type ShortLinkRecord,
} from '../../domain/entities/short-link.entity';
import { ShortLinkRepository } from '../../infrastructure/repositories/short-link.repository';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import {
  ResolvedStateSchema,
  detectResolverEnvironment,
  type ResolvedState,
} from '@repo/shared';

const EDGE_CACHE_TTL_SEC = 86400; // 24h edge cache (§5.2)
const CLICK_STREAM = 'stream:resolver:clicks'; // §7.1 attribution stream

function cacheKey(shortCode: string): string {
  return `resolver:code:${shortCode}`;
}

function clicksKey(linkId: string): string {
  return `resolver:clicks:${linkId}`;
}

@Injectable()
export class DeepLinkResolverService {
  private readonly logger = new Logger(DeepLinkResolverService.name);

  constructor(
    private readonly repo: ShortLinkRepository,
    private readonly crypto: HmacCryptoService,
    private readonly redis: RedisClusterService,
  ) {}

  generateSignature(data: Record<string, unknown>): string {
    return this.crypto.generateSignature(data);
  }

  /** Verify + decrypt a base64url `liff.state` payload (fail-closed 401). */
  verifyAndDecryptState(encryptedState: string): ResolvedState {
    try {
      const decodedJson = Buffer.from(encryptedState, 'base64url').toString('utf-8');
      const parsedData = JSON.parse(decodedJson) as Record<string, unknown>;
      const { signature, ...payload } = parsedData;
      if (typeof signature !== 'string' || !this.crypto.verifySignature(payload, signature)) {
        throw new UnauthorizedException('Tampered deep-link signature detected.');
      }
      return ResolvedStateSchema.parse(parsedData);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired liff.state payload.');
    }
  }

  /** Resolve a short code → link row (Redis-first, DB fallback + re-cache). */
  async resolveShortCode(shortCode: string, userAgent: string, ip: string, referer?: string) {
    const key = cacheKey(shortCode);
    const cached = await this.redis.get(key).catch(() => null);
    let row: ShortLinkRecord | null = null;

    if (cached) {
      try {
        row = JSON.parse(cached) as ShortLinkRecord;
      } catch {
        this.logger.warn(`Corrupt resolver cache rebuilt: ${key}`);
        await this.redis.del(key).catch(() => undefined);
        row = null;
      }
    }
    if (!row) {
      const dbLink = await this.repo.findByCode(shortCode);
      if (!dbLink || !dbLink.isActive) {
        throw new NotFoundException('Short code not found or expired.');
      }
      row = dbLink as unknown as ShortLinkRecord;
      await this.redis
        .setex(key, EDGE_CACHE_TTL_SEC, JSON.stringify(row))
        .catch(() => undefined);
    }

    assertResolvable(row);
    const link = row as ShortLinkRecord;
    // Live redemption count: the edge copy may hold a stale clickCount, so
    // merge the Redis live counter before enforcing the cap (Gate 7).
    const stored = await this.redis.get(clicksKey(link.id)).catch(() => null);
    const live = stored ? Number.parseInt(stored, 10) || 0 : 0;
    const effective: ShortLinkRecord = {
      ...link,
      clickCount: Math.max(link.clickCount, live),
    };
    assertResolvable(effective);
    const environment = detectResolverEnvironment(userAgent);

    // Non-blocking click log + counters + attribution stream (never fail redirect).
    void this.repo
      .logClick({ shortLinkId: link.id, environment, ipAddress: ip, userAgent, referer })
      .catch(() => undefined);
    void this.repo.incrementClicks(link.id).catch(() => undefined);
    // Refresh the edge copy + live counter so the next hit enforces the cap
    // without a DB read (best-effort; DB increment stays the source of truth).
    const nextCount = effective.clickCount + 1;
    void this.redis
      .setex(key, EDGE_CACHE_TTL_SEC, JSON.stringify({ ...link, clickCount: nextCount }))
      .catch(() => undefined);
    void this.redis.setex(clicksKey(link.id), EDGE_CACHE_TTL_SEC, String(nextCount)).catch(() => undefined);
    void this.redis
      .publish(
        CLICK_STREAM,
        JSON.stringify({
          event: 'resolver.click',
          shortCode,
          linkId: link.id,
          tenantId: link.tenantId,
          environment,
          affiliateCode: link.affiliateCode ?? null,
          at: new Date().toISOString(),
        }),
      )
      .catch(() => undefined);

    return effective;
  }
}
