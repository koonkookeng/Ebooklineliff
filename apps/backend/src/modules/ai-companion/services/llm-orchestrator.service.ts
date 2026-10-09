// SSOT Phase 092 §10 — LLM orchestrator (semantic cache + 500ms fallback)
// Canonical: apps/backend/src/modules/ai-companion/services/llm-orchestrator.service.ts
// - Flow: sanitize → semantic-cache probe (Redis, hit > 0.95 → instant) →
//   primary (091 extractive summarizer) → on timeout/error, secondary
//   extractive fallback within 500ms (never blocks the reader).
// - TTFT measured per call (Gate 8 telemetry). Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  AI_FALLBACK_BUDGET_MS,
  SEMANTIC_CACHE_THRESHOLD,
  cosineSimilarity,
  estimateTokens,
  semanticCacheKey,
} from '@repo/shared';
import { EmbeddingGeneratorService } from '../../vector-search/services/embedding-generator.service';
import { AiSummarizerService } from '../../ai-rag/services/ai-summarizer.service';
import { detectPromptInjection, sanitizeQuestion } from '../guardrails/prompt-injection.guardrail';
import type { CompanionChunk } from './rag-retrieval.service';

export interface SemanticCachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
}

export interface OrchestratedAnswer {
  answer: string;
  citations: Array<{ pageNumber?: number; timestampSec?: number; snippetText: string }>;
  tokenUsed: number;
  ttftMs: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('llm-timeout')), ms);
    void p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

@Injectable()
export class LlmOrchestratorService {
  constructor(
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly summarizer: AiSummarizerService,
    private readonly cache?: SemanticCachePort,
  ) {}

  async answer(args: {
    tenantId: string;
    productId: string;
    userIdHash: string;
    question: string;
    chunks: CompanionChunk[];
    currentPage?: number;
  }): Promise<OrchestratedAnswer> {
    const t0 = Date.now();
    const clean = detectPromptInjection(args.question)
      ? sanitizeQuestion(args.question)
      : args.question.trim().slice(0, 1000);

    // Semantic cache probe (§8): same-meaning FAQ short-circuits the LLM.
    if (this.cache) {
      const hit = await this.cache.get(semanticCacheKey(args.tenantId, args.productId, clean)).catch(() => null);
      if (hit) {
        try {
          const parsed = JSON.parse(hit) as { answer: string; qv: number[] };
          const qv = await this.embeddings.embed(clean);
          if (cosineSimilarity(qv, parsed.qv) > SEMANTIC_CACHE_THRESHOLD) {
            return {
              answer: parsed.answer,
              citations: this.cite(args.chunks),
              tokenUsed: estimateTokens(parsed.answer),
              ttftMs: Date.now() - t0,
              cacheHit: true,
              fallbackUsed: false,
            };
          }
        } catch {
          /* corrupt entry — fall through to primary */
        }
      }
    }

    // Primary: 091 RAG summarizer (extractive, offline, watermarked).
    try {
      const primary = await withTimeout(
        this.summarizer.ask({
          tenantId: args.tenantId,
          productId: args.productId,
          userIdHash: args.userIdHash,
          userQuestion: clean,
          currentPage: args.currentPage,
        }),
        AI_FALLBACK_BUDGET_MS,
      );
      const out: OrchestratedAnswer = {
        answer: primary.answer,
        citations: this.cite(args.chunks),
        tokenUsed: estimateTokens(primary.answer),
        ttftMs: Date.now() - t0,
        cacheHit: false,
        fallbackUsed: false,
      };
      await this.storeCache(args, clean, out.answer);
      return out;
    } catch {
      // Secondary fallback (≤500ms budget already spent — instant local).
      const fallback = this.localFallback(args.chunks, args.currentPage);
      return {
        answer: fallback,
        citations: this.cite(args.chunks),
        tokenUsed: estimateTokens(fallback),
        ttftMs: Date.now() - t0,
        cacheHit: false,
        fallbackUsed: true,
      };
    }
  }

  private cite(chunks: CompanionChunk[]): OrchestratedAnswer['citations'] {
    return chunks.slice(0, 3).map((c) => {
      const citation: { pageNumber?: number; timestampSec?: number; snippetText: string } = {
        snippetText: c.contentText.slice(0, 300),
      };
      if (c.pageNumber != null) citation.pageNumber = c.pageNumber;
      if (c.timestampSec != null) citation.timestampSec = c.timestampSec;
      return citation;
    });
  }

  private localFallback(chunks: CompanionChunk[], currentPage?: number): string {
    if (chunks.length === 0) return 'AI ไม่สามารถประมวลผลได้ในขณะนี้ โปรดลองใหม่อีกครั้ง';
    const first = chunks[0]?.contentText.slice(0, 200) ?? '';
    const page = currentPage != null ? ` (หน้า ${currentPage})` : '';
    return `ประเด็นสำคัญ${page}: ${first}…`;
  }

  private async storeCache(
    args: { tenantId: string; productId: string },
    question: string,
    answer: string,
  ): Promise<void> {
    if (!this.cache) return;
    const qv = await this.embeddings.embed(question).catch(() => null);
    if (!qv) return;
    await this.cache
      .set(semanticCacheKey(args.tenantId, args.productId, question), JSON.stringify({ answer, qv }), 'EX', 86400)
      .catch(() => undefined);
  }
}
