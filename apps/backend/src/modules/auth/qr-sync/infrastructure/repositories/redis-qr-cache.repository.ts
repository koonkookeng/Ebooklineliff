// SSOT Phase 007 §5.1 — Redis QR session repository (hot state, 60s TTL, single-use consume)
// Canonical: apps/backend/src/modules/auth/qr-sync/infrastructure/repositories/redis-qr-cache.repository.ts
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../../infra/redis/redis-cluster.service';
import { QR_TTL_SEC, assertTransition } from '../../domain/entities/qr-session.entity';
import type { QrSessionStatus } from '@repo/shared';

export interface QrSessionState {
  qrToken: string;
  nonceHash: string;
  status: QrSessionStatus;
  socketChannel: string;
  tenantId: string;
  desktopIp: string | null;
  mobileIp: string | null;
  scannedByUserId: string | null;
  deviceFingerprint: string | null;
  pinHash: string | null;
  riskScore: number;
  attempts: number;
  oneTimeCodeHash: string | null;
  authorizedUserId: string | null;
  expiresAt: number;
}

export function qrSessionKey(qrToken: string): string {
  return `qr_session:${qrToken}`;
}

export function qrChannel(qrToken: string): string {
  return `qr:${qrToken}`;
}

@Injectable()
export class RedisQrCacheRepository {
  constructor(private readonly redis: RedisClusterService) {}

  async createInitial(state: Omit<QrSessionState, 'status' | 'attempts' | 'riskScore'>): Promise<QrSessionState> {
    const full: QrSessionState = { ...state, status: 'PENDING', attempts: 0, riskScore: 0 };
    const claimed = await this.redis.setnx(qrSessionKey(state.qrToken), JSON.stringify(full), QR_TTL_SEC);
    if (!claimed) throw new Error('QR_SESSION_CONFLICT');
    return full;
  }

  async read(qrToken: string): Promise<QrSessionState | null> {
    const raw = await this.redis.get(qrSessionKey(qrToken)).catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as QrSessionState;
    } catch {
      return null;
    }
  }

  async write(qrToken: string, state: QrSessionState): Promise<void> {
    const ttl = Math.max(1, Math.floor((state.expiresAt - Date.now()) / 1000));
    await this.redis.setex(qrSessionKey(qrToken), ttl, JSON.stringify(state));
  }

  /** Generic edge-cache write (e.g. desktop session flags alongside QR state). */
  async writeRaw(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.setex(key, ttlSec, value);
  }

  async transition(qrToken: string, to: QrSessionStatus): Promise<QrSessionState> {
    const current = await this.read(qrToken);
    if (!current) throw new Error('QR_SESSION_EXPIRED');
    assertTransition(current.status, to);
    const next: QrSessionState = { ...current, status: to };
    await this.write(qrToken, next);
    return next;
  }

  /** Atomic single-use consume via GETDEL: exactly one caller receives the state. */
  async consume(qrToken: string): Promise<QrSessionState> {
    const raw = await this.redis.getdel(qrSessionKey(qrToken)).catch(() => null);
    if (!raw) throw new Error('QR_SESSION_EXPIRED');
    try {
      return JSON.parse(raw) as QrSessionState;
    } catch {
      throw new Error('QR_SESSION_EXPIRED');
    }
  }
}
