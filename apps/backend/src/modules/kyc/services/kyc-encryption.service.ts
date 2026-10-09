// SSOT Phase 085 Task 3 — AES-256-GCM field encryption (PDPA §8)
// Canonical: apps/backend/src/modules/kyc/services/kyc-encryption.service.ts
// - encrypt/decrypt envelope: base64(iv):base64(tag):base64(ciphertext).
//   Key: KYC_ENC_KEY (64-hex) env-first, phase fallback documented.
// - Port-based (ctor key) for DB-free tests. Zero new deps (node:crypto).
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function resolveKycKey(explicit?: string): Buffer {
  const raw = (explicit ?? process.env['KYC_ENC_KEY'] ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw) {
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) return b;
    } catch {
      // Fall through to the documented development fallback.
    }
  }
  // Development fallback (phase convention) — provision KYC_ENC_KEY in prod.
  return createHash32('secret-key-144-xz/kyc-fallback');
}

function createHash32(s: string): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(s).digest();
}

@Injectable()
export class KycEncryptionService {
  private readonly key: Buffer;

  constructor(key?: Buffer | string) {
    this.key = Buffer.isBuffer(key) ? key : resolveKycKey(typeof key === 'string' ? key : undefined);
    if (this.key.length !== 32) throw new Error('KYC encryption key must be 32 bytes');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  }

  decrypt(envelope: string): string {
    const [ivB64, tagB64, ctB64] = envelope.split(':');
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed KYC envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
