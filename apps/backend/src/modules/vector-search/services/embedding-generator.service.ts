// SSOT Phase 091 §5.1/§7.1 — Deterministic embedding engine (port + local)
// Canonical: apps/backend/src/modules/vector-search/services/embedding-generator.service.ts
// - RISK_CALL: ships a deterministic hash-based 1536-dim engine (zero new
//   deps, offline, <50ms). OpenAI-compatible seam via EmbeddingPort — swap
//   the provider without touching callers (Single Source per §9).
// - Output is L2-normalized so cosine == dot product.
import { Injectable } from '@nestjs/common';
import { EMBEDDING_DIMS } from '@repo/shared';

export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
}

function hashToken(token: string, dims: number): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % dims;
}

export function deterministicEmbedding(text: string, dims = EMBEDDING_DIMS): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/[\s,.!?;:()"'“”‘’—–\-/\\|]+/).filter(Boolean);
  for (const token of tokens) {
    vec[hashToken(token, dims)] += 1;
    vec[hashToken(`pos:${token}`, dims)] += 0.5;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm <= 0) return vec;
  return vec.map((v) => v / norm);
}

@Injectable()
export class EmbeddingGeneratorService implements EmbeddingPort {
  async embed(text: string): Promise<number[]> {
    return deterministicEmbedding(text);
  }
}
