// SSOT Phase 107 §5.1 — FieldEncryptionService (AES-256-GCM center core)
// Canonical: apps/backend/src/common/crypto/field-encryption.service.ts
// (legacy src/backend/common/crypto/field-encryption.service.ts)
// - §9 Zero Redundant Code: ALL field crypto rides this service (no dupes).
// - scrypt(secret, salt, 32) master key; 16-byte IV; hex wire format;
//   EncryptedFieldSchema-shaped envelopes ({ciphertext, iv, authTag, keyVersion}).
// - blindIndex() = HMAC-SHA256 peppered hash (exact-match search, §8.1).
// - maskField() delegates to @repo/shared (single mask source, BDD Scenario 2).
// - Zero new deps (node:crypto only).
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import {
  EncryptedFieldSchema,
  maskByFieldType,
  type EncryptedField,
  type SensitiveFieldType,
} from '@repo/shared';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

@Injectable()
export class FieldEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly masterKey: Buffer;
  private readonly keyVersion = 1;
  private readonly blindPepper: string;

  constructor(secret?: string, salt?: string, pepper?: string) {
    const resolvedSecret = secret ?? process.env.PII_ENCRYPTION_SECRET ?? 'default-pdpa-secret-key-32-bytes!';
    const resolvedSalt = salt ?? process.env.PII_ENCRYPTION_SALT ?? 'ahong-emerald-salt';
    this.masterKey = scryptSync(resolvedSecret, resolvedSalt, 32);
    this.blindPepper = pepper ?? process.env.PII_BLIND_PEPPER ?? 'ahong-blind-pepper';
  }

  encrypt(plainText: string): EncryptedData {
    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      const envelope: EncryptedData = {
        ciphertext: encrypted,
        iv: iv.toString('hex'),
        authTag,
        keyVersion: this.keyVersion,
      };
      EncryptedFieldSchema.parse(envelope);
      return envelope;
    } catch (error) {
      if ((error as Error)?.name === 'ZodError') throw error;
      throw new InternalServerErrorException('Field encryption failed');
    }
  }

  decrypt(encryptedData: EncryptedData): string {
    try {
      const parsed: EncryptedField = EncryptedFieldSchema.parse(encryptedData);
      const decipher = createDecipheriv(
        this.algorithm,
        this.masterKey,
        Buffer.from(parsed.iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'));
      let decrypted = decipher.update(parsed.ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      if ((error as Error)?.name === 'ZodError') throw error;
      throw new InternalServerErrorException('Field decryption failed or data tampered');
    }
  }

  /** Blind index for exact-match queries without decryption (§8.1). */
  blindIndex(value: string): string {
    return createHmac('sha256', this.blindPepper).update(value).digest('hex');
  }

  maskField(value: string, type: 'PHONE' | 'BANK' | 'ID_CARD' | SensitiveFieldType): string {
    if (!value) return '';
    const normalized: SensitiveFieldType =
      type === 'PHONE' ? 'PHONE_NUMBER' : type === 'BANK' ? 'BANK_ACCOUNT' : type === 'ID_CARD' ? 'NATIONAL_ID' : type;
    return maskByFieldType(value, normalized);
  }
}
