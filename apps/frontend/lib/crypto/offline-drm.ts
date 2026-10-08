// SSOT Phase 068 Task 5 — WebCrypto offline DRM (AES-256-GCM, §8.1)
// Canonical: apps/frontend/lib/crypto/offline-drm.ts
// (legacy src/frontend/lib/crypto/offline-drm.ts)
// - Chunk-scoped AES-256-GCM (12B IV per chunk, ≤2MB); key imported from the
//   base64 content key delivered once at license issuance (TLS) and stored
//   device-local (same-origin IDB). Ephemeral: plaintext lives only in the
//   worker's chunk buffer, never persisted decrypted.
// - Offline license check = expiry window + SHA-256 integrity (§BDD-2);
//   authenticity is bound at server issuance (HMAC, opaque token).
// - Zero new deps (WebCrypto only).
import { DOWNLOAD_CHUNK_BYTES } from '@repo/shared';

export interface OfflineLicenseRecord {
  licenseToken: string;
  contentKeyB64: string;
  productId: string;
  deviceIdHash: string;
  validUntil: string;
  integrityHash: string;
}

async function importContentKey(contentKeyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(contentKeyB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt one chunk → {iv, ciphertext} (worker-side, ≤2MB). */
export async function encryptChunk(contentKeyB64: string, plaintext: ArrayBuffer): Promise<{ iv: ArrayBuffer; ciphertext: ArrayBuffer }> {
  if (plaintext.byteLength > DOWNLOAD_CHUNK_BYTES) throw new Error('chunk exceeds 2MB budget');
  const key = await importContentKey(contentKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: iv.buffer, ciphertext };
}

/** Decrypt one chunk for render (ephemeral buffer, never persisted). */
export async function decryptChunk(contentKeyB64: string, iv: ArrayBuffer, ciphertext: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await importContentKey(contentKeyB64);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, ciphertext);
}

/** SHA-256 integrity over the stored license JSON (tamper-evidence). */
export async function licenseIntegrityHash(record: Omit<OfflineLicenseRecord, 'integrityHash'>): Promise<string> {
  const bytes = new TextEncoder().encode(
    [record.licenseToken, record.contentKeyB64, record.productId, record.deviceIdHash, record.validUntil].join(':'),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Offline gate: integrity match + validity window (BDD-2). */
export async function verifyOfflineLicense(record: OfflineLicenseRecord, nowMs = Date.now()): Promise<'VALID' | 'EXPIRED' | 'TAMPERED'> {
  const { integrityHash, ...body } = record;
  if ((await licenseIntegrityHash(body)) !== integrityHash) return 'TAMPERED';
  if (new Date(record.validUntil).getTime() <= nowMs) return 'EXPIRED';
  return 'VALID';
}
