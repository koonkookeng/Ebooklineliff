// SSOT Phase 087 §3.1 — Flash sale & countdown contract
// Canonical: packages/shared/src/schemas/flash-sale-contract.ts
// (legacy src/shared/schemas/flash-sale-contract.ts — placeholder until now)
// - Spec-verbatim: FlashSaleStatusEnum / FlashSaleProductItemSchema /
//   ReserveStockInputSchema / ReserveStockResponseSchema (§3.1, tenantId
//   min(1) per 071 vocabulary).
// - Pure helpers: discount %, cluster-safe key builders (ONE hash tag per
//   Lua script — cross-slot scripts fail on Redis Cluster), hold TTL,
//   rate-limit keys, campaign-phase derivation (server UTC), countdown
//   parts, analytics stream.
// - Zero new deps (zod only).
import { z } from 'zod';

export const FlashSaleStatusEnum = z.enum(['UPCOMING', 'ACTIVE', 'PAUSED', 'ENDED', 'SOLD_OUT']);
export type FlashSaleStatus = z.infer<typeof FlashSaleStatusEnum>;

export const FlashSaleProductItemSchema = z.object({
  productId: z.string().uuid(),
  originalPrice: z.number().positive(),
  flashSalePrice: z.number().positive(),
  allocatedStock: z.number().int().nonnegative(),
  reservedStock: z.number().int().nonnegative(),
  soldQty: z.number().int().nonnegative(),
  maxPerUser: z.number().int().positive().default(1),
});
export type FlashSaleProductItem = z.infer<typeof FlashSaleProductItemSchema>;

export const ReserveStockInputSchema = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
});
export type ReserveStockInput = z.infer<typeof ReserveStockInputSchema>;

export const ReserveStockResponseSchema = z.object({
  success: z.boolean(),
  reservationToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
  message: z.string(),
  remainingStock: z.number().int(),
});
export type ReserveStockResponse = z.infer<typeof ReserveStockResponseSchema>;

/** Payment hold on a reservation: 10 minutes (BDD-1). */
export const FLASH_HOLD_TTL_SEC = 600;
/** Reserve rate limit: 1 request / 3s per user (§8). */
export const FLASH_RESERVE_RATE_WINDOW_SEC = 3;
/** Flash analytics stream (Gate 8). */
export const FLASH_STREAM = 'channel:flash_sale_updates';

/** Discount percent, floored int: 1000→799 = 20%. */
export function flashDiscountPct(originalPrice: number, flashPrice: number): number {
  if (!(originalPrice > 0) || flashPrice >= originalPrice) return 0;
  return Math.floor(((originalPrice - flashPrice) / originalPrice) * 100);
}

/**
 * Cluster-safe key tag. BOTH Lua keys MUST share `{flash:<campaign>:<product>}`
 * — Redis Cluster rejects cross-slot scripts (CROSSSLOT).
 */
export function flashTag(campaignId: string, productId: string): string {
  return `{flash:${campaignId}:${productId}}`;
}

/** Available-stock counter key (seeded from DB allocated − reserved − sold). */
export function flashStockKey(campaignId: string, productId: string): string {
  return `${flashTag(campaignId, productId)}:stock`;
}

/** Per-user take counter key (maxPerUser guard, same slot as stock). */
export function flashUserKey(campaignId: string, productId: string, userId: string): string {
  return `${flashTag(campaignId, productId)}:user:${userId}`;
}

/** Reserve rate-limit key (3s sliding window). */
export function flashRateKey(userId: string): string {
  return `flash:ratelimit:${userId}`;
}

/** Remaining units from the item ledger (never negative). */
export function flashRemaining(allocated: number, reserved: number, sold: number): number {
  return Math.max(0, allocated - reserved - sold);
}

/** Server-UTC campaign phase (client clocks never trusted). */
export function campaignPhase(args: {
  status: string;
  startTime: number;
  endTime: number;
  remaining: number;
}, now = Date.now()): 'UPCOMING' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'SOLD_OUT' {
  if (args.status === 'PAUSED') return 'PAUSED';
  if (now < args.startTime) return 'UPCOMING';
  if (now >= args.endTime) return 'ENDED';
  if (args.remaining <= 0) return 'SOLD_OUT';
  return 'ACTIVE';
}

/** Countdown parts down to centiseconds (client render tick). */
export function countdownParts(targetMs: number, now = Date.now()): {
  hours: string; minutes: string; seconds: string; millis: string; expired: boolean;
} {
  const diff = targetMs - now;
  if (diff <= 0) {
    return { hours: '00', minutes: '00', seconds: '00', millis: '00', expired: true };
  }
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return {
    hours: pad(Math.floor(diff / 3_600_000)),
    minutes: pad(Math.floor(diff / 60_000) % 60),
    seconds: pad(Math.floor(diff / 1000) % 60),
    millis: pad(Math.floor((diff % 1000) / 10)),
    expired: false,
  };
}
