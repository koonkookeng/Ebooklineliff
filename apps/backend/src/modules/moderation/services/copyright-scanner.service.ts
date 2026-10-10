// SSOT Phase 112 Task 4 §7 — copyright scanner (simhash pHash + fingerprint ledger)
// Canonical: apps/backend/src/modules/moderation/services/copyright-scanner.service.ts
// (legacy src/backend/modules/moderation/.../copyright-scanner.service.ts)
// - Text near-duplicate (real): 64-bit simhash over 5-shingles; Hamming
//   distance ≤3 against stored textEmbeddingHash values → matched. Exact
//   SHA-256 equality short-circuits first.
// - Binary near-duplicate (exact, real): SHA-256 of cover/keyframe bytes vs
//   stored perceptualHash values. Pixel-level pHash stays a provider seam
//   (documented RISK_CALL — no vision dep in repo; the digest lane accepts
//   worker-supplied digests instead of fabricating pixel verdicts).
// - Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

export interface CopyrightScanResult {
  isMatched: boolean;
  score: number;
  violatingLocations: string[];
  matchedFingerprintId?: string;
}

/** Max Hamming distance for a simhash near-duplicate verdict. */
export const SIMHASH_HAMMING_LIMIT = 3;

function shingles(text: string, k = 5): string[] {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm.length < k) return norm ? [norm] : [];
  const out: string[] = [];
  for (let i = 0; i <= norm.length - k; i++) out.push(norm.slice(i, i + k));
  return out;
}

function hash64(token: string): bigint {
  const h = createHash('sha256').update(token, 'utf8').digest();
  return h.readBigUInt64BE(0);
}

/** 64-bit simhash of text (hex, 16 chars). Empty text → null. */
export function simhash(text: string): string | null {
  const grams = shingles(text);
  if (grams.length === 0) return null;
  const acc = new Array<number>(64).fill(0);
  for (const g of grams) {
    const h = hash64(g);
    for (let i = 0; i < 64; i++) acc[i]! += (h >> BigInt(i)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (acc[i]! > 0) out |= 1n << BigInt(i);
  return out.toString(16).padStart(16, '0');
}

/** Hamming distance between two 16-hex-char simhashes. */
export function hamming(aHex: string, bHex: string): number {
  let x = BigInt(`0x${aHex}`) ^ BigInt(`0x${bHex}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** SHA-256 hex digest of binary content (cover / keyframe bytes). */
export function shaDigest(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class CopyrightScannerService {
  /**
   * Match text samples + binary digests against stored fingerprints.
   * fingerprints: rows with { id, perceptualHash, textEmbeddingHash }.
   */
  async scanCopyrightMatch(
    args: { textSamples?: Array<{ text: string; location: string }>; binaryDigests?: Array<{ digest: string; location: string }> },
    fingerprints: Array<{ id: string; perceptualHash: string; textEmbeddingHash: string | null }>,
  ): Promise<CopyrightScanResult> {
    const byHash = new Map(fingerprints.map((f) => [f.perceptualHash, f.id] as const));
    const simRows = fingerprints.filter((f) => f.textEmbeddingHash && /^[0-9a-f]{16}$/.test(f.textEmbeddingHash));

    for (const b of args.binaryDigests ?? []) {
      const hit = byHash.get(b.digest);
      if (hit) {
        return { isMatched: true, score: 1, violatingLocations: [b.location], matchedFingerprintId: hit };
      }
    }
    let best: { id: string; dist: number; location: string } | null = null;
    for (const s of args.textSamples ?? []) {
      const h = simhash(s.text);
      if (!h) continue;
      for (const f of simRows) {
        const d = hamming(h, f.textEmbeddingHash as string);
        if (d <= SIMHASH_HAMMING_LIMIT && (!best || d < best.dist)) {
          best = { id: f.id, dist: d, location: s.location };
        }
      }
    }
    if (best) {
      return { isMatched: true, score: 1 - best.dist / 64, violatingLocations: [best.location], matchedFingerprintId: best.id };
    }
    return { isMatched: false, score: 0, violatingLocations: [] };
  }

  /** Build the fingerprint row persisted for a newly passed product. */
  fingerprintFor(productId: string, args: { textSeed: string; binarySeed?: string | Buffer }): {
    productId: string; perceptualHash: string; textEmbeddingHash: string | null; digitalWatermarkId: string;
  } {
    return {
      productId,
      perceptualHash: shaDigest(args.binarySeed ?? productId),
      textEmbeddingHash: simhash(args.textSeed),
      digitalWatermarkId: randomUUID(),
    };
  }
}
