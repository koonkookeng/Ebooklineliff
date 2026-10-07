// SSOT Phase 032 Task 2/§5.2 — Reverse geocoding service (cache-first, PDPA-safe)
// Canonical: apps/backend/src/modules/permission/reverse-geocoding.service.ts
// (legacy src/backend/modules/permission/reverse-geocoding.service.ts)
// - Grid-rounded cache key (~110m cells, 30d TTL, Gate 6 — repeat lookups cost
//   zero egress); per-user district cache upserted on every resolve.
// - Gate 4 (PDPA Zero Location Persistence): exact GPS is NEVER written — only
//   the resolved subdistrict/district/province/postalCode persist; raw coords
//   live in the request/response only.
// - Provider integration is env-driven (GEOCODE_PROVIDER_URL, POST {lat,lng} →
//   ReverseGeocodeResult); unconfigured → 503 with a clear message instead of a
//   fabricated address (zero-mock policy). Cache hits still serve instantly.
// - Zero new deps: global fetch + Prisma SSOT + RedisClusterService only.
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  GEOCODE_CACHE_TTL_SEC,
  GeolocationCoordinatesSchema,
  ReverseGeocodeResultSchema,
  geocodeCacheKey,
  type ReverseGeocodeResult,
} from '@repo/shared';

interface LocationTables {
  userLocationCache: {
    upsert: (args: unknown) => Promise<unknown>;
  };
}

@Injectable()
export class ReverseGeocodingService {
  private readonly logger = new Logger(ReverseGeocodingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get tables(): LocationTables {
    return this.prisma as unknown as LocationTables;
  }

  /** Resolve lat/lng → Thai admin address (800ms budget, BDD Scenario 2). */
  async getAddressFromCoords(userId: string, lat: number, lng: number): Promise<ReverseGeocodeResult> {
    const coords = GeolocationCoordinatesSchema.safeParse({ latitude: lat, longitude: lng, accuracy: 0 });
    if (!coords.success) throw new BadRequestException('Invalid coordinates');
    if (!userId) throw new BadRequestException('Missing user id');

    const key = geocodeCacheKey(coords.data.latitude, coords.data.longitude);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      const hit = ReverseGeocodeResultSchema.safeParse(JSON.parse(cached) as unknown);
      if (hit.success) {
        await this.rememberUserAddress(userId, coords.data.latitude, coords.data.longitude, hit.data);
        return hit.data;
      }
      this.logger.warn(`Corrupt geocode cache entry ignored: ${key}`);
    }

    const providerUrl = process.env.GEOCODE_PROVIDER_URL;
    if (!providerUrl) {
      throw new ServiceUnavailableException('Geocoding provider not configured (GEOCODE_PROVIDER_URL)');
    }
    let result: ReverseGeocodeResult;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(providerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords.data.latitude, lng: coords.data.longitude }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`provider ${res.status}`);
      const checked = ReverseGeocodeResultSchema.safeParse(await res.json());
      if (!checked.success) throw new Error('provider shape violation');
      result = checked.data;
    } catch (err) {
      this.logger.warn(`Geocode provider failed: ${err instanceof Error ? err.message : 'unknown'}`);
      throw new ServiceUnavailableException('Geocoding provider unavailable');
    }

    await this.redis.setex(key, GEOCODE_CACHE_TTL_SEC, JSON.stringify(result)).catch(() => undefined);
    await this.rememberUserAddress(userId, coords.data.latitude, coords.data.longitude, result);
    return result;
  }

  /**
   * Persist district-level address only (Gate 4): coordinates are grid-rounded
   * to 3 decimals (~110m, same grain as the cache key) — exact GPS is never
   * stored, raw coords live in the request/response only.
   */
  private async rememberUserAddress(userId: string, latitude: number, longitude: number, result: ReverseGeocodeResult): Promise<void> {
    const gridLat = Math.round(latitude * 1000) / 1000;
    const gridLng = Math.round(longitude * 1000) / 1000;
    await this.tables.userLocationCache
      .upsert({
        where: { userId },
        update: {
          latitude: gridLat,
          longitude: gridLng,
          subdistrict: result.subdistrict,
          district: result.district,
          province: result.province,
          postalCode: result.postalCode,
        },
        create: {
          userId,
          latitude: gridLat,
          longitude: gridLng,
          subdistrict: result.subdistrict,
          district: result.district,
          province: result.province,
          postalCode: result.postalCode,
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Location cache write failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
  }
}
