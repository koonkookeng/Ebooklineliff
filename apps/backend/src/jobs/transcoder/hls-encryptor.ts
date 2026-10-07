// SSOT Phase 043 Task 4/§8.2 — HLS AES-128 key material (pure crypto)
// Canonical: apps/backend/src/jobs/transcoder/hls-encryptor.ts
// (legacy src/backend/jobs/transcoder/hls-encryptor.ts)
// - Per-lesson 128-bit key + IV (randomBytes), hex-encoded for the
//   VideoKeyRotation row; keyinfo file content for the FFmpeg
//   -hls_key_info_file flag (key URI served short-lived by stream.service).
// - Pure + tsx-safe. Zero new deps (node:crypto only).
import { randomBytes } from 'node:crypto';

export interface Aes128KeyMaterial {
  keyHex: string;
  ivHex: string;
}

/** Fresh 16-byte key + 16-byte IV, hex-encoded (32 chars each). */
export function generateAes128Key(): Aes128KeyMaterial {
  return { keyHex: randomBytes(16).toString('hex'), ivHex: randomBytes(16).toString('hex') };
}

/** FFmpeg keyinfo file body: <key URI>\n<binary key path>\n<IV hex>. */
export function keyinfoFile(keyUri: string, keyFilePath: string, ivHex: string): string {
  return `${keyUri}\n${keyFilePath}\n${ivHex}`;
}

/** Binary key file bytes written beside the keyinfo (never committed). */
export function keyFileBytes(keyHex: string): Buffer {
  return Buffer.from(keyHex, 'hex');
}
