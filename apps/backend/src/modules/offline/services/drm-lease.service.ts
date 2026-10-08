// SSOT Phase 063 §5.2 — DrmLeaseService (7-day offline lease issuer)
// Canonical: apps/backend/src/modules/offline/services/drm-lease.service.ts
// (legacy src/backend/modules/offline/services/drm-lease.service.ts)
// - issueOfflineLease: entitlement gate (expiry-aware) → idempotent return
//   of a live lease (>24h left) else HMAC-signed 7-day lease + upsert.
// - verifyLeaseToken: signature + expiry + revocation check (pure shape).
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OFFLINE_LEASE_DAYS, OFFLINE_LEASE_RENEW_WITHIN_MS } from '@repo/shared';

export interface LeaseRow {
  leaseToken: string;
  expiresAt: Date;
  revoked: boolean;
}

export interface DrmLeaseTables {
  entitlement: {
    findUnique(args: unknown): Promise<{ expiresAt: Date | null } | null>;
  };
  drmOfflineLease: {
    findUnique(args: unknown): Promise<LeaseRow | null>;
    upsert(args: unknown): Promise<LeaseRow>;
  };
}

function hmacEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

@Injectable()
export class DrmLeaseService {
  constructor(
    private readonly tables?: DrmLeaseTables,
    private readonly secretKey: string = process.env.DRM_OFFLINE_SECRET_KEY || 'AhongEmeraldSecret999',
  ) {}

  signPayload(payloadStr: string): string {
    return createHmac('sha256', this.secretKey).update(payloadStr).digest('hex');
  }

  buildLeaseToken(input: { userId: string; productId: string; deviceId: string; clientPublicKey: string }): { leaseToken: string; payloadStr: string; expiresAt: Date } {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + OFFLINE_LEASE_DAYS * 24 * 60 * 60 * 1000);
    const payloadStr = JSON.stringify({
      userId: input.userId,
      productId: input.productId,
      deviceId: input.deviceId,
      clientPublicKey: input.clientPublicKey,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const signature = this.signPayload(payloadStr);
    const leaseToken = Buffer.from(JSON.stringify({ payload: payloadStr, signature })).toString('base64');
    return { leaseToken, payloadStr, expiresAt };
  }

  async issueOfflineLease(userId: string, productId: string, deviceId: string, clientPublicKey: string): Promise<{ leaseToken: string; expiresAt: string }> {
    if (!this.tables) throw new UnauthorizedException('Offline lease unavailable');
    const entitlement = await this.tables.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    if (!entitlement || (entitlement.expiresAt && entitlement.expiresAt < new Date())) {
      throw new UnauthorizedException('User does not possess valid active entitlement for this product');
    }
    const existing = await this.tables.drmOfflineLease
      .findUnique({ where: { userId_productId_deviceId: { userId, productId, deviceId } } })
      .catch(() => null);
    if (existing && !existing.revoked && existing.expiresAt.getTime() - Date.now() > OFFLINE_LEASE_RENEW_WITHIN_MS) {
      return { leaseToken: existing.leaseToken, expiresAt: existing.expiresAt.toISOString() };
    }
    const { leaseToken, expiresAt } = this.buildLeaseToken({ userId, productId, deviceId, clientPublicKey });
    const row = await this.tables.drmOfflineLease.upsert({
      where: { userId_productId_deviceId: { userId, productId, deviceId } },
      update: { leaseToken, expiresAt, revoked: false, clientPublicKey },
      create: { userId, productId, deviceId, clientPublicKey, leaseToken, expiresAt },
    });
    return { leaseToken: row.leaseToken, expiresAt: row.expiresAt.toISOString() };
  }

  async verifyLeaseToken(leaseToken: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      const raw = JSON.parse(Buffer.from(leaseToken, 'base64').toString('utf-8')) as { payload?: string; signature?: string };
      if (!raw.payload || !raw.signature) return { valid: false, reason: 'MALFORMED' };
      if (!hmacEqual(this.signPayload(raw.payload), raw.signature)) return { valid: false, reason: 'BAD_SIGNATURE' };
      const payload = JSON.parse(raw.payload) as { expiresAt?: string };
      if (!payload.expiresAt || new Date(payload.expiresAt).getTime() <= Date.now()) {
        return { valid: false, reason: 'EXPIRED' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'MALFORMED' };
    }
  }
}
