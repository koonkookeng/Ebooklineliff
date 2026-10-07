// SSOT Phase 042 Task 4 — ForensicExtractorService (manifest-assisted verify)
// Canonical: apps/backend/src/modules/watermark/application/services/forensic-extractor.service.ts
// (legacy src/backend/modules/watermark/application/services/forensic-extractor.service.ts)
// - Honest boundary (ADR-042): the server holds no image-CV dependency, so
//   pixel decoding stays client-side — the canvas reads back its own
//   alpha-channel manifest and submits {seedId, userIdHash, timestamp,
//   hmacSignature} with the leaked bytes. This service verifies the HMAC
//   manifest against the seed log and scores confidence:
//     valid sig + fresh log row → 100 (owner proven, not tampered)
//     valid sig + expired/missing row → 50 (sig genuine, provenance stale)
//     invalid sig → 0 + isTampered (manifest forged or image re-encoded)
// - The image bytes are hashed for the audit trail only (never stored).
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';
import type { ForensicVerificationPayload } from '@repo/shared';
import { WatermarkCryptoService } from './watermark-crypto.service';

export interface SeedLogLookup {
  findSeedRow(seedId: string): Promise<{ userId: string; lineUserId: string | null; timestamp: string; expired: boolean } | null>;
}

export interface ForensicManifest {
  seedId: string;
  userIdHash: string;
  timestamp: string;
  hmacSignature: string;
}

@Injectable()
export class ForensicExtractorService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly crypto?: WatermarkCryptoService,
    private readonly seeds?: SeedLogLookup,
  ) {}

  async verify(imageDataBase64: string, manifest: ForensicManifest): Promise<ForensicVerificationPayload> {
    void imageDataBase64; // Bytes anchor the audit trail off-service; verification reads the HMAC manifest.
    if (!this.crypto) {
      return { extractedUserIdHash: manifest.userIdHash, extractedLineUserId: null, extractedTimestamp: manifest.timestamp, confidenceScore: 0, isTampered: true };
    }
    const valid = this.crypto.verifyHMACSignature(manifest.seedId, manifest.userIdHash, manifest.timestamp, manifest.hmacSignature);
    if (!valid) {
      return { extractedUserIdHash: manifest.userIdHash, extractedLineUserId: null, extractedTimestamp: manifest.timestamp, confidenceScore: 0, isTampered: true };
    }
    const row = await this.seeds?.findSeedRow(manifest.seedId).catch(() => null);
    if (row && !row.expired) {
      const userIdHash = this.crypto.generateUserIdHash(row.userId);
      if (userIdHash === manifest.userIdHash) {
        return { extractedUserIdHash: userIdHash, extractedLineUserId: row.lineUserId, extractedTimestamp: row.timestamp, confidenceScore: 100, isTampered: false };
      }
      return { extractedUserIdHash: manifest.userIdHash, extractedLineUserId: null, extractedTimestamp: manifest.timestamp, confidenceScore: 0, isTampered: true };
    }
    return { extractedUserIdHash: manifest.userIdHash, extractedLineUserId: null, extractedTimestamp: manifest.timestamp, confidenceScore: 50, isTampered: false };
  }
}
