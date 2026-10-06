// SSOT Phase 013 §7/§8 — PromptPay abuse guard (rate-limit + fraud freeze)
// Canonical: apps/backend/src/modules/payment/services/promptpay-guard.service.ts
// Uses only get/setex/del on RedisClusterService (cluster-safe, no Lua/incr).
// All failures fail OPEN for reads but the QR path calls assertAllowed first,
// so abuse never mints new QR payloads; slip-verify hooks record strikes.
import { Injectable, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  PROMPTPAY_RATE_LIMIT,
  PROMPTPAY_RATE_WINDOW_SEC,
  PROMPTPAY_FRAUD_STRIKES,
  PROMPTPAY_FRAUD_FREEZE_SEC,
} from '@repo/shared';

const rlKey = (userId: string): string => `pp_rl:{${userId}}`;
const fraudKey = (userId: string): string => `pp_fraud:{${userId}}`;

interface FraudState {
  strikes: number;
  suspendedUntil: number;
}

const parseStamps = (raw: string | null): number[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
};

const parseFraud = (raw: string | null): FraudState => {
  if (!raw) return { strikes: 0, suspendedUntil: 0 };
  try {
    const v = JSON.parse(raw) as Partial<FraudState>;
    return {
      strikes: typeof v.strikes === 'number' ? v.strikes : 0,
      suspendedUntil: typeof v.suspendedUntil === 'number' ? v.suspendedUntil : 0,
    };
  } catch {
    return { strikes: 0, suspendedUntil: 0 };
  }
};

@Injectable()
export class PromptPayGuardService {
  constructor(private readonly redis: RedisClusterService) {}

  /** Throws 429 (rate) or 403 (fraud freeze); records this generation attempt. */
  async assertAllowed(userId: string): Promise<void> {
    if (!userId) throw new ForbiddenException('Missing user id');
    const now = Date.now();
    const fraud = parseFraud(await this.redis.get(fraudKey(userId)).catch(() => null));
    if (fraud.suspendedUntil > now) {
      const retrySec = Math.ceil((fraud.suspendedUntil - now) / 1000);
      throw new ForbiddenException(`QR ถูกระงับชั่วคราว ${retrySec} วินาที (ตรวจพบสลิปผิดปกติ)`);
    }
    const windowStart = now - PROMPTPAY_RATE_WINDOW_SEC * 1000;
    const stamps = parseStamps(await this.redis.get(rlKey(userId)).catch(() => null)).filter((t) => t > windowStart);
    if (stamps.length >= PROMPTPAY_RATE_LIMIT) {
      throw new HttpException('สร้าง QR เกิน 5 ครั้ง/10 นาที กรุณารอสักครู่', HttpStatus.TOO_MANY_REQUESTS);
    }
    stamps.push(now);
    await this.redis.setex(rlKey(userId), PROMPTPAY_RATE_WINDOW_SEC, JSON.stringify(stamps)).catch(() => undefined);
  }

  /** Records a failed slip attempt; freezes QR generation on reaching strikes. Best-effort. */
  async recordSlipFailure(userId: string): Promise<void> {
    if (!userId) return;
    const raw = await this.redis.get(fraudKey(userId)).catch(() => null);
    const state = parseFraud(raw);
    state.strikes += 1;
    if (state.strikes >= PROMPTPAY_FRAUD_STRIKES) {
      state.suspendedUntil = Date.now() + PROMPTPAY_FRAUD_FREEZE_SEC * 1000;
    }
    await this.redis.setex(fraudKey(userId), PROMPTPAY_FRAUD_FREEZE_SEC, JSON.stringify(state)).catch(() => undefined);
  }

  /** Clears strikes after a verified payment. Best-effort. */
  async clearOnSuccess(userId: string): Promise<void> {
    if (!userId) return;
    await this.redis.del(fraudKey(userId)).catch(() => undefined);
  }
}
