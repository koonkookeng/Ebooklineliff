// SSOT Phase 087 §5.2 — Atomic stock lock service (Lua + DB reconcile)
// Canonical: apps/backend/src/modules/flash-sale/services/redis-stock-lock.service.ts
// (legacy class name RedisStockLockServiceService renamed — no importers.)
// - reserveStockAtomic: rate gate (1/3s) -> item load (+ Redis seed) ->
//   Lua eval (stock + per-user guards, one slot) -> HOLD row + user counter
//   TTL + stream. OUT_OF_STOCK paths write nothing (BDD-1 zero overhead).
// - The Lua source of truth is the embedded constant (no fs reads — dist
//   layouts differ); lua/reserve_stock.lua mirrors it for Redis admins and
//   the contract test asserts byte-parity (normalized).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  FLASH_HOLD_TTL_SEC,
  FLASH_RESERVE_RATE_WINDOW_SEC,
  FLASH_STREAM,
  flashRateKey,
  flashRemaining,
  flashStockKey,
  flashUserKey,
} from '@repo/shared';

export const RESERVE_STOCK_LUA = [
  "local current_stock = tonumber(redis.call('GET', KEYS[1]) or '-1')",
  "if current_stock == -1 then",
  '  return {0, "ITEM_NOT_FOUND_IN_CACHE", 0}',
  'end',
  '',
  'if current_stock < tonumber(ARGV[1]) then',
  '  return {0, "OUT_OF_STOCK", current_stock}',
  'end',
  '',
  "local user_bought = tonumber(redis.call('GET', KEYS[2]) or '0')",
  'if (user_bought + tonumber(ARGV[1])) > tonumber(ARGV[2]) then',
  '  return {0, "EXCEEDS_MAX_PER_USER", current_stock}',
  'end',
  '',
  "redis.call('DECRBY', KEYS[1], ARGV[1])",
  "redis.call('INCRBY', KEYS[2], ARGV[1])",
  '',
  'return {1, "SUCCESS", current_stock - tonumber(ARGV[1])}',
].join('\n');

export interface StockLockPort {
  evalLua(script: string, keys: string[], argv: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  expire(key: string, seconds: number): Promise<void>;
  incr(key: string): Promise<number>;
  del(...keys: string[]): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class RedisStockLockService {
  constructor(
    private readonly redis: RedisClusterService,
    private readonly prisma: PrismaService,
  ) {}

  async reserveStockAtomic(args: {
    campaignId: string;
    productId: string;
    userId: string;
    quantity?: number;
  }): Promise<{ success: boolean; reservationToken: string | null; expiresAt: string | null; message: string; remainingStock: number }> {
    const quantity = args.quantity ?? 1;
    const lock = this.redis as unknown as StockLockPort;
    // §8 rate gate: 1 reserve / 3s per user (fail-closed on Redis faults).
    try {
      const hits = await lock.incr(flashRateKey(args.userId));
      if (hits === 1) await lock.expire(flashRateKey(args.userId), FLASH_RESERVE_RATE_WINDOW_SEC);
      if (hits > 1) {
        return { success: false, reservationToken: null, expiresAt: null, message: 'RATE_LIMITED', remainingStock: 0 };
      }
    } catch {
      return { success: false, reservationToken: null, expiresAt: null, message: 'RATE_LIMITER_UNAVAILABLE', remainingStock: 0 };
    }

    const db = this.prisma as unknown as {
      flashSaleItem: {
        findUnique(a: unknown): Promise<{
          id: string; flashPrice: unknown; allocatedStock: number;
          reservedStock: number; soldQty: number; maxPerUser: number;
        } | null>;
      };
      stockReservation: { create(a: unknown): Promise<{ reservationToken: string }> };
    };
    const item = await db.flashSaleItem
      .findUnique({ where: { campaignId_productId: { campaignId: args.campaignId, productId: args.productId } } })
      .catch(() => null);
    if (!item) {
      return { success: false, message: 'Flash sale item not found', reservationToken: null, expiresAt: null, remainingStock: 0 };
    }

    const stockKey = flashStockKey(args.campaignId, args.productId);
    const userKey = flashUserKey(args.campaignId, args.productId, args.userId);
    try {
      const seeded = await lock.set(stockKey, String(flashRemaining(item.allocatedStock, item.reservedStock, item.soldQty)), 'NX');
      void seeded;
    } catch {
      return { success: false, reservationToken: null, expiresAt: null, message: 'CACHE_UNAVAILABLE', remainingStock: 0 };
    }

    let status = 0;
    let code = 'OUT_OF_STOCK';
    let remaining = 0;
    try {
      const out = (await lock.evalLua(
        RESERVE_STOCK_LUA,
        [stockKey, userKey],
        [String(quantity), String(item.maxPerUser)],
      )) as [number, string, number];
      [status, code, remaining] = out;
    } catch {
      return { success: false, reservationToken: null, expiresAt: null, message: 'LOCK_ENGINE_UNAVAILABLE', remainingStock: 0 };
    }

    if (status !== 1) {
      return { success: false, reservationToken: null, expiresAt: null, message: code, remainingStock: Number(remaining) || 0 };
    }

    const expiresAt = new Date(Date.now() + FLASH_HOLD_TTL_SEC * 1000);
    const reservation = await db.stockReservation.create({
      data: {
        flashSaleItemId: item.id,
        userId: args.userId,
        quantity,
        status: 'HOLD',
        expiresAt,
      },
    });
    try {
      await lock.expire(userKey, FLASH_HOLD_TTL_SEC);
      await lock.xaddPipeline(FLASH_STREAM, [
        { event: 'flash.reserved', campaignId: args.campaignId, productId: args.productId, remainingStock: Number(remaining) || 0, at: Date.now() },
      ]);
    } catch {
      // Reservation row is source of truth; telemetry is best-effort.
    }
    return {
      success: true,
      reservationToken: reservation.reservationToken,
      expiresAt: expiresAt.toISOString(),
      message: 'Stock reserved successfully',
      remainingStock: Number(remaining) || 0,
    };
  }
}
