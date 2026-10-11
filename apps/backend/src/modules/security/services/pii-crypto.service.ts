// SSOT Phase 129 §5.2/Gate 3 — PII AES-256-GCM facade (spec §5.2 shape)
// Canonical: apps/backend/src/modules/security/services/pii-crypto.service.ts
// (legacy src/backend/modules/security/services/pii-crypto.service.ts)
// - RISK_CALL: no second AES implementation — §9 Zero Redundant Code rides
//   the Phase 107 FieldEncryptionService (scrypt master key, 16-byte IV,
//   authTag, keyVersion). This facade only adapts its envelope to the 129
//   spec shape { encryptedData, iv, authTag } and adds batch helpers for
//   the EncryptedUserPII vault row (phone/address/taxId).
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

@Injectable()
export class PiiCryptoService {
  constructor(private readonly fields: FieldEncryptionService = new FieldEncryptionService()) {}

  encrypt(text: string): PiiEncryptedBundle {
    const env = this.fields.encrypt(text);
    return { encryptedData: env.ciphertext, iv: env.iv, authTag: env.authTag };
  }

  decrypt(bundle: PiiEncryptedBundle): string {
    return this.fields.decrypt({
      ciphertext: bundle.encryptedData,
      iv: bundle.iv,
      authTag: bundle.authTag,
      keyVersion: 1,
    });
  }

  /** Encrypt the three vault columns; one shared IV/authTag per row write. */
  encryptVaultRow(input: { phone?: string; address?: string; taxId?: string }): PiiVaultRow {
    const pick = (v?: string): PiiEncryptedBundle | null => (v ? this.encrypt(v) : null);
    const phone = pick(input.phone);
    const address = pick(input.address);
    const taxId = pick(input.taxId);
    const anchor = phone ?? address ?? taxId;
    return {
      ...(phone ? { encryptedPhone: phone.encryptedData } : {}),
      ...(address ? { encryptedAddress: address.encryptedData } : {}),
      ...(taxId ? { encryptedTaxId: taxId.encryptedData } : {}),
      encryptionIv: anchor?.iv ?? '',
      authTag: anchor?.authTag ?? '',
    };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const PiiCryptoServiceService = PiiCryptoService;
