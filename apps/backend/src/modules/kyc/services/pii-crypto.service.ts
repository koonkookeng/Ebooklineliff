// SSOT Phase 111 Task 2 §8.2 — PII crypto facade (AES-256-GCM, PDPA)
// Canonical: apps/backend/src/modules/kyc/services/pii-crypto.service.ts
// (legacy src/backend/modules/kyc/.../pii-crypto.service.ts)
// - Zero-duplication facade over KycEncryptionService (085 Task 3 owns the
//   AES-256-GCM envelope: base64(iv):base64(tag):base64(ct), KYC_ENC_KEY
//   env-first with documented dev fallback). 111 adds PDPA masking helpers
//   + blind-index helper re-export only — no second cipher implementation.
// - Zero new deps (node:crypto via delegate).
import { Injectable } from '@nestjs/common';
import { KycEncryptionService } from './kyc-encryption.service';
export { resolveKycKey } from './kyc-encryption.service';

/** Mask a 13-digit Thai ID as 1-1004-XXXXX-12-1 (§8.2 data masking). */
export function maskIdCardNumber(idCardNumber: string): string {
  const d = idCardNumber.replace(/\D/g, '');
  if (d.length !== 13) return 'X-XXXX-XXXXX-XX-X';
  return `${d[0]}-${d.slice(1, 5)}-XXXXX-${d.slice(10, 12)}-${d[12]}`;
}

/** Mask a bank account as XXX-X-X1234-X (first/middle hidden). */
export function maskBankAccountNumber(accountNumber: string): string {
  const d = accountNumber.replace(/\D/g, '');
  if (d.length < 4) return 'XXXX';
  return `XXX-X-X${d.slice(-5, -1)}-X`;
}

@Injectable()
export class PiiCryptoService {
  constructor(private readonly delegate: KycEncryptionService) {}

  encrypt(plain: string): string {
    return this.delegate.encrypt(plain);
  }

  decrypt(envelope: string): string {
    return this.delegate.decrypt(envelope);
  }

  maskIdCard(idCardNumber: string): string {
    return maskIdCardNumber(idCardNumber);
  }

  maskBankAccount(accountNumber: string): string {
    return maskBankAccountNumber(accountNumber);
  }
}
