// SSOT Phase 011 §4-§5 — Shipping adapter (zone + rate-table lookup, <300ms, cached)
// Canonical: apps/backend/src/modules/cart/infrastructure/shipping-adapter.service.ts
// Strategy: ShippingRateTable rows win when present; tiered weight pricing is the
// offline fallback (single source: cart-split.vo tieredShippingFee). Results cached 1h.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { tieredShippingFee } from '../domain/value-objects/cart-split.vo';
import type { Carrier } from '@repo/shared';

export type ProvinceZone = 'BANGKOK_METRO' | 'UPCOUNTRY' | 'REMOTE';
export const CARRIERS: Carrier[] = ['FLASH', 'KERRY', 'THAIPOST'];
const RATE_TTL_SEC = 3600;

export interface ShippingQuote {
  carrier: Carrier;
  zone: ProvinceZone;
  fee: number;
  estimatedDays: [number, number];
}

const TRANSIT_DAYS: Record<Carrier, [number, number]> = {
  FLASH: [1, 3],
  KERRY: [1, 2],
  THAIPOST: [2, 4],
};

/** Postal-code → province zone (Bangkok 10xxx; deep-south 94-96xxx remote; else upcountry). */
export function resolveZone(postalCode: string): ProvinceZone {
  const zip = (postalCode ?? '').trim();
  if (/^10\d{3}$/.test(zip)) return 'BANGKOK_METRO';
  if (/^(94|95|96)\d{3}$/.test(zip)) return 'REMOTE';
  return 'UPCOUNTRY';
}

const toNum = (v: unknown, fallback: number): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return (v as { toNumber(): number }).toNumber() ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

@Injectable()
export class ShippingAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private key(carrier: Carrier, zone: ProvinceZone, weightGrams: number): string {
    return `shipping:rate:${carrier}:${zone}:${weightGrams}`;
  }

  /** Single-carrier fee: cache → rate table → tiered fallback. Never throws (fallback 35). */
  async quoteCarrier(carrier: Carrier, postalCode: string, weightGrams: number): Promise<ShippingQuote> {
    const zone = resolveZone(postalCode);
    const weight = Math.max(0, Math.floor(weightGrams));
    if (weight === 0) {
      return { carrier, zone, fee: tieredShippingFee(0), estimatedDays: TRANSIT_DAYS[carrier] };
    }
    const cacheKey = this.key(carrier, zone, weight);
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit !== null && hit !== undefined) {
        const fee = Number(hit);
        if (Number.isFinite(fee)) return { carrier, zone, fee, estimatedDays: TRANSIT_DAYS[carrier] };
      }
    } catch {
      // cache failure → continue to table lookup (availability over speed)
    }
    let fee = tieredShippingFee(weight);
    try {
      const rows = await (this.prisma as unknown as { shippingRateTable: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> } }).shippingRateTable
        .findMany({ where: { carrierName: carrier, provinceZone: zone } });
      const match = rows.find(
        (r) => weight >= Number(r['minWeightGrams']) && weight <= Number(r['maxWeightGrams']),
      );
      if (match) fee = toNum(match['baseFee'], fee);
    } catch {
      // table unavailable → tiered fallback stands
    }
    try {
      await this.redis.setex(cacheKey, RATE_TTL_SEC, String(fee));
    } catch {
      // best-effort cache
    }
    return { carrier, zone, fee, estimatedDays: TRANSIT_DAYS[carrier] };
  }

  /** All-carrier quotes in parallel (single round, <300ms on warm cache). */
  async quoteAll(postalCode: string, weightGrams: number): Promise<ShippingQuote[]> {
    return Promise.all(CARRIERS.map((c) => this.quoteCarrier(c, postalCode, weightGrams)));
  }

  /** Cheapest fee across carriers, or the preferred carrier's fee when requested. */
  async cheapest(postalCode: string, weightGrams: number, preferred?: Carrier): Promise<ShippingQuote> {
    const quotes = await this.quoteAll(postalCode, weightGrams);
    if (preferred) {
      const hit = quotes.find((q) => q.carrier === preferred);
      if (hit) return hit;
    }
    return quotes.reduce((best, q) => (q.fee < best.fee ? q : best));
  }
}
