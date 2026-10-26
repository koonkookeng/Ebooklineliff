// SSOT Phase 129 §5.2/Gate 3 — PII AES-256-GCM facade (spec §5.2 shape)
// Canonical: apps/backend/src/modules/security/services/pii-crypto.service.ts
// (legacy src/backend/modules/security/services/pii-crypto.service.ts)
// - RISK_CALL: no second AES implementation — §9 Zero Redundant Code rides
//   the Phase 107 FieldEncryptionService (scrypt master key, 16-byte IV,
//   authTag, keyVersion). This facade only adapts its envelope to the 129
//   spec shape { encryptedData, iv, authTag } and adds batch helpers for
//   the EncryptedUserPII vault row (phone/address/taxId).
// - Vault rows hold three independent ciphertexts. Each column therefore
//   carries its own self-describing envelope (`v1:<iv>:<authTag>:<ct>`);
//   the row-level encryptionIv/authTag mirror the first present field for
//   the spec's single-IV column contract and legacy anchor reads.
//   decryptVaultField() is the only correct way to read a non-anchor column.
// - Zero new deps (node:crypto rides the 107 lane).
import { Injectable } from '@nestjs/common';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';

export interface PiiEncryptedBundle {
  encryptedData: string;
  iv: string;
  authTag: string;
}

export interface PiiVaultRow {
  encryptedPhone?: string | null;
  encryptedAddress?: string | null;
  encryptedTaxId?: string | null;
  encryptionIv: string;
  authTag: string;
}

export type PiiVaultField = 'phone' | 'address' | 'taxId';

const VAULT_PREFIX = 'v1:';

/** Pack a bundle into a self-describing vault column value. */
export function packVaultField(bundle: PiiEncryptedBundle): string {
  return `${VAULT_PREFIX}${bundle.iv}:${bundle.authTag}:${bundle.encryptedData}`;
}

/** Unpack a self-describing column value (null for legacy raw ciphertext). */
export function unpackVaultField(packed: string): PiiEncryptedBundle | null {
  if (!packed.startsWith(VAULT_PREFIX)) return null;
  const [iv, authTag, ...ciphertext] = packed.slice(VAULT_PREFIX.length).split(':');
  if (!iv || !authTag || ciphertext.length === 0) return null;
  return { iv, authTag, encryptedData: ciphertext.join(':') };
}

const VAULT_COLUMN: Record<PiiVaultField, 'encryptedPhone' | 'encryptedAddress' | 'encryptedTaxId'> = {
  phone: 'encryptedPhone',
  address: 'encryptedAddress',
  taxId: 'encryptedTaxId',
};

@Injectable()
export class PiiCryptoService {
  constructor(private readonly fields: FieldEncryptionService = new FieldEncryptionService()) {}

  encrypt(text: string): PiiEncryptedBundle {
    const env = this.fields.encrypt(text);
    return { encryptedData: env.ciphertext, iv: env.iv, authTag: env.authTag };
  }

  decrypt(bundle: PiiEncryptedBundle): string {
    // Accept both a raw {ciphertext,iv,authTag} bundle and a packed vault
    // column (its embedded IV/authTag win: each field has its own pair).
    const inner = unpackVaultField(bundle.encryptedData) ?? bundle;
    return this.fields.decrypt({
      ciphertext: inner.encryptedData,
      iv: inner.iv,
      authTag: inner.authTag,
      keyVersion: 1,
    });
  }

  /** Encrypt the three vault columns; every column gets its own envelope. */
  encryptVaultRow(input: { phone?: string; address?: string; taxId?: string }): PiiVaultRow {
    const packed = (v?: string): string | undefined => (v ? packVaultField(this.encrypt(v)) : undefined);
    const phone = packed(input.phone);
    const address = packed(input.address);
    const taxId = packed(input.taxId);
    const anchor = phone ?? address ?? taxId;
    const anchorBundle = anchor ? unpackVaultField(anchor) : null;
    return {
      ...(phone ? { encryptedPhone: phone } : {}),
      ...(address ? { encryptedAddress: address } : {}),
      ...(taxId ? { encryptedTaxId: taxId } : {}),
      encryptionIv: anchorBundle?.iv ?? '',
      authTag: anchorBundle?.authTag ?? '',
    };
  }

  /** Decrypt one vault column (null when the column is absent). */
  decryptVaultField(row: PiiVaultRow, field: PiiVaultField): string | null {
    const packed = row[VAULT_COLUMN[field]];
    if (!packed) return null;
    return this.decrypt({
      encryptedData: packed,
      iv: row.encryptionIv,
      authTag: row.authTag,
    });
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const PiiCryptoServiceService = PiiCryptoService;
