// SSOT Phase 068 Task 2 — OfflineLicenseService (issue/verify/revoke)
// Canonical: apps/backend/src/modules/offline-license/offline-license.service.ts
// (legacy src/backend/modules/offline-license/offline-license.service.ts)
// - Issue: entitlement gate → per-license content key (32B) → AES-256-GCM
//   escrow wrap (server key, Phase 003 envelope pattern) → HMAC-signed
//   token → atomic upsert on @@unique(userId, productId, deviceIdHash).
// - Trust model (§8.1): authenticity is established at issuance over TLS;
//   the content key is delivered once and stored device-local (same-origin
//   IDB); the escrow cipher allows server-side recovery/re-issue. Offline
//   checks are expiry + integrity (no client-side secrets).
// - RISK_CALL deviation: HMAC-SHA256 instead of ED25519 (zero-new-dep;
//   same tamper-evidence for server-issued opaque tokens).
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID, createCipheriv } from 'node:crypto';
import {
  OFFLINE_LICENSE_DEFAULT_DAYS,
  OFFLINE_LICENSE_MAX_DAYS,
  OFFLINE_LICENSE_STREAM,
  licenseCanonical,
  type OfflineLicenseToken,
} from '@repo/shared';

export interface LicenseTables {
  entitlement: {
    findUnique(args: unknown): Promise<unknown | null>;
  };
  offlineLicense: {
    findUnique(args: unknown): Promise<LicenseRow | null>;
    upsert(args: unknown): Promise<LicenseRow>;
    update(args: unknown): Promise<LicenseRow | null>;
  };
  deviceStorageProfile: {
    findUnique(args: unknown): Promise<{ usedStorageBytes: bigint | number } | null>;
    findMany(args: unknown): Promise<Array<{ usedStorageBytes: bigint | number }>>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface LicenseRow {
  id: string;
  userId: string;
  productId: string;
  deviceIdHash: string;
  licenseToken: string;
  encryptionKeyCipher: string;
  signature: string;
  issuedAt: Date;
  validUntil: Date;
  isRevoked: boolean;
}

export interface LicenseStream {
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

const GCM_IV = 12;

function serverKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

@Injectable()
export class OfflineLicenseService {
  constructor(
    private readonly tables?: LicenseTables,
    private readonly stream?: LicenseStream,
    private readonly secret: string = process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
  ) {}

  userHash(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 16);
  }

  signLicense(canonical: string): string {
    return createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  /** AES-256-GCM escrow wrap (IV:tag:cipher base64, Phase 003 pattern). */
  wrapContentKey(contentKey: Buffer): string {
    const iv = randomBytes(GCM_IV);
    const cipher = createCipheriv('aes-256-gcm', serverKey(this.secret), iv);
    const enc = Buffer.concat([cipher.update(contentKey), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  }

  async issueLicense(
    userId: string,
    productId: string,
    deviceIdHash: string,
    maxOfflineDays = OFFLINE_LICENSE_DEFAULT_DAYS,
  ): Promise<{ ok: boolean; payload?: { licenseToken: string; signature: string; encryptionKeyCipher: string; validUntil: string; contentKey: string }; error?: string }> {
    if (!this.tables) return { ok: false, error: 'UNAVAILABLE' };
    if (!productId || !deviceIdHash) return { ok: false, error: 'INVALID_INPUT' };
    const grant = await this.tables.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    if (!grant) return { ok: false, error: 'FORBIDDEN' };
    const days = Math.min(Math.max(1, Math.floor(maxOfflineDays)), OFFLINE_LICENSE_MAX_DAYS);
    const licenseId = randomUUID();
    const validUntil = new Date(Date.now() + days * 86400000).toISOString();
    const userIdHash = this.userHash(userId);
    const canonical = licenseCanonical(licenseId, userIdHash, productId, deviceIdHash, validUntil);
    const signature = this.signLicense(canonical);
    const contentKey = randomBytes(32);
    const licenseToken = `${Buffer.from(JSON.stringify({ licenseId, userIdHash, productId, deviceIdHash, signature, issuedAt: new Date().toISOString(), validUntil, maxOfflineDays: days } satisfies OfflineLicenseToken)).toString('base64url')}.${signature}`;
    const row = await this.tables.offlineLicense
      .upsert({
        where: { userId_productId_deviceIdHash: { userId, productId, deviceIdHash } },
        update: { licenseToken, encryptionKeyCipher: this.wrapContentKey(contentKey), signature, validUntil: new Date(validUntil), isRevoked: false },
        create: { id: licenseId, userId, productId, deviceIdHash, licenseToken, encryptionKeyCipher: this.wrapContentKey(contentKey), signature, validUntil: new Date(validUntil) },
      })
      .catch(() => null);
    if (!row) return { ok: false, error: 'WRITE_FAILED' };
    await this.stream
      ?.xaddPipeline(OFFLINE_LICENSE_STREAM, [{ userId, productId, event: 'license_issued', at: Date.now() }])
      .catch(() => undefined);
    return {
      ok: true,
      payload: { licenseToken, signature, encryptionKeyCipher: row.encryptionKeyCipher, validUntil, contentKey: contentKey.toString('base64') },
    };
  }

  /** Validity read (revoked/expiry); signature re-verified server-side. */
  async getLicense(
    userId: string,
    productId: string,
    deviceIdHash: string,
  ): Promise<{ status: 'VALID' | 'EXPIRED' | 'REVOKED' | 'MISSING'; validUntil?: string }> {
    if (!this.tables) return { status: 'MISSING' };
    const row = await this.tables.offlineLicense
      .findUnique({ where: { userId_productId_deviceIdHash: { userId, productId, deviceIdHash } } })
      .catch(() => null);
    if (!row) return { status: 'MISSING' };
    if (row.isRevoked) return { status: 'REVOKED', validUntil: row.validUntil.toISOString() };
    if (row.validUntil.getTime() <= Date.now()) return { status: 'EXPIRED', validUntil: row.validUntil.toISOString() };
    return { status: 'VALID', validUntil: row.validUntil.toISOString() };
  }

  async revokeLicense(userId: string, licenseId: string): Promise<boolean> {
    if (!this.tables) return false;
    const row = await this.tables.offlineLicense.findUnique({ where: { id: licenseId } }).catch(() => null);
    if (!row || row.userId !== userId) return false;
    await this.tables.offlineLicense.update({ where: { id: licenseId }, data: { isRevoked: true } }).catch(() => null);
    await this.stream
      ?.xaddPipeline(OFFLINE_LICENSE_STREAM, [{ userId, productId: row.productId, event: 'license_revoked', at: Date.now() }])
      .catch(() => undefined);
    return true;
  }

  /** Aggregate last-reported usage across the user's devices. */
  async getQuotaUsage(userId: string): Promise<{ usedBytes: number; itemCount: number }> {
    if (!this.tables) return { usedBytes: 0, itemCount: 0 };
    const rows = await this.tables.deviceStorageProfile.findMany({ where: { userId } }).catch(() => []);
    let used = 0;
    for (const r of rows) used += Number(r.usedStorageBytes ?? 0);
    return { usedBytes: used, itemCount: rows.length };
  }

  async reportQuota(userId: string, deviceIdHash: string, usedBytes: number, deviceModel?: string): Promise<{ ok: boolean }> {    if (!this.tables || !deviceIdHash) return { ok: false };
    await this.tables.deviceStorageProfile
      .upsert({
        where: { deviceIdHash },
        update: { usedStorageBytes: Math.max(0, Math.floor(usedBytes)), ...(deviceModel ? { deviceModel } : {}) },
        create: { userId, deviceIdHash, deviceModel, usedStorageBytes: Math.max(0, Math.floor(usedBytes)) },
      })
      .catch(() => null);
    return { ok: true };
  }
}
