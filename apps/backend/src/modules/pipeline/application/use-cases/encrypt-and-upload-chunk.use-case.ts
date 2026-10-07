// SSOT Phase 038 Task 4 — Encrypt + upload chunk use-case (AES-256-GCM)
// Canonical: apps/backend/src/modules/pipeline/application/use-cases/encrypt-and-upload-chunk.use-case.ts
// (legacy src/backend/modules/pipeline/application/use-cases/encrypt-and-upload-chunk.use-case.ts)
// - Envelope (§5.2 rule): scrypt(secret=watermarkSeed:bookId) → AES-256-GCM
//   (12B iv) → {encryptedData hex, iv hex, authTag hex, sha256(plaintext)}.
// - Pure encryptPayload() exported for unit tests (deterministic round-trip).
// - Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { R2VaultAdapter } from '../../infrastructure/storage/r2-vault.adapter';

export interface ChunkEnvelope {
  encryptedData: string;
  iv: string;
  authTag: string;
  hash: string;
}

function deriveKey(watermarkSeed: string, bookId: string): Buffer {
  return scryptSync(`${watermarkSeed}:${bookId}`, 'ebook-vault-salt', 32);
}

/** AES-256-GCM envelope (pure, round-trip tested). */
export function encryptPayload(plaintext: string, watermarkSeed: string, bookId: string): ChunkEnvelope {
  if (!plaintext) throw new Error('Empty chunk plaintext');
  if (!watermarkSeed || !bookId) throw new Error('Missing encryption identity');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(watermarkSeed, bookId), iv);
  const encryptedData = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return {
    encryptedData,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    hash: createHash('sha256').update(plaintext, 'utf8').digest('hex'),
  };
}

/** Decrypt helper (reader/key-server side; round-trip tested). */
export function decryptPayload(envelope: ChunkEnvelope, watermarkSeed: string, bookId: string): string {
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(watermarkSeed, bookId), Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'));
  return decipher.update(envelope.encryptedData, 'hex', 'utf8') + decipher.final('utf8');
}

@Injectable()
export class EncryptAndUploadChunkUseCase {
  constructor(private readonly vault: R2VaultAdapter) {}

  async execute(objectKey: string, plaintext: string, watermarkSeed: string, bookId: string): Promise<ChunkEnvelope> {
    const envelope = encryptPayload(plaintext, watermarkSeed, bookId);
    await this.vault.uploadBuffer(objectKey, JSON.stringify(envelope), 'application/json');
    return envelope;
  }
}
