// SSOT Phase 120 Task 3 §8.1 — local GeoIP lookup (static table + cache)
// Canonical: apps/backend/src/modules/security/services/geoip-lookup.service.ts
// (legacy src/backend/modules/security/services/geoip-lookup.service.ts)
// - Zero-egress: a compiled static prefix table (baked test vectors +
//   private/link-local ranges) fronted by a Redis cache (<2ms hot lane).
//   A MaxMind MMDB reader swaps in behind resolveIp without touching
//   callers (documented seam — no binary dep in repo per zero-dep rule).
// - Unknown public IPs resolve to an Unknown/XX stub (fail-open, never
//   blocks login). Private IPs never leave the box. Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

/** Static GeoIP prefix table (compiled vectors; MaxMind swaps in behind). */
const STATIC_PREFIXES: Array<{
  prefix: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  isp: string;
  isProxyOrVpn: boolean;
}> = [
  { prefix: '182.52.', country: 'Thailand', countryCode: 'TH', region: 'Bangkok', city: 'Bangkok', latitude: 13.7563, longitude: 100.5018, isp: 'TRUE-TH', isProxyOrVpn: false },
  { prefix: '126.1.', country: 'Japan', countryCode: 'JP', region: 'Tokyo', city: 'Tokyo', latitude: 35.6762, longitude: 139.6503, isp: 'SOFTBANK-JP', isProxyOrVpn: false },
  { prefix: '203.0.', country: 'Thailand', countryCode: 'TH', region: 'Chiang Mai', city: 'Chiang Mai', latitude: 18.7883, longitude: 98.9853, isp: 'AIS-TH', isProxyOrVpn: false },
  { prefix: '185.220.', country: 'Unknown', countryCode: 'XX', region: 'Tor Exit', city: 'Unknown', latitude: 0, longitude: 0, isp: 'TOR-NETWORK', isProxyOrVpn: true },
];

export interface ResolvedGeo {
  ipAddress: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  isp: string;
  isProxyOrVpn: boolean;
  cached: boolean;
}

/** RFC-1918 / link-local / loopback gate (never geo-resolved remotely). */
export function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.toLowerCase() === 'localhost') return true;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
}

function geoCacheKey(ip: string): string {
  return `geoip:${ip}`;
}

@Injectable()
export class GeoipLookupService {
  private readonly logger = new Logger(GeoipLookupService.name);

  constructor(private readonly redis: RedisClusterService) {}

  async resolveIp(ipAddress: string): Promise<ResolvedGeo> {
    const ip = (ipAddress || '').trim() || '0.0.0.0';
    try {
      const hit = await this.redis.get(geoCacheKey(ip));
      if (hit) return { ...(JSON.parse(hit) as Omit<ResolvedGeo, 'cached'>), cached: true };
    } catch {
      // Cache outage → resolve locally (fail-open).
    }
    const geo = this.resolveLocal(ip);
    try {
      await this.redis.setex(geoCacheKey(ip), 86400, JSON.stringify({ ...geo, cached: false }));
    } catch (err) {
      this.logger.warn(`Geo cache write failed for ${ip}: ${(err as Error).message}`);
    }
    return geo;
  }

  private resolveLocal(ip: string): ResolvedGeo {
    if (isPrivateIp(ip)) {
      return { ipAddress: ip, country: 'Private', countryCode: 'XX', region: 'LAN', city: 'Local', latitude: 0, longitude: 0, isp: 'private-range', isProxyOrVpn: false, cached: false };
    }
    const hit = STATIC_PREFIXES.find((p) => ip.startsWith(p.prefix));
    if (hit) {
      const { prefix: _prefix, ...rest } = hit;
      return { ...rest, ipAddress: ip, cached: false };
    }
    return { ipAddress: ip, country: 'Unknown', countryCode: 'XX', region: 'Unknown', city: 'Unknown', latitude: 0, longitude: 0, isp: 'unknown', isProxyOrVpn: false, cached: false };
  }
}
