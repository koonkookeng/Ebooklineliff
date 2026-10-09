// SSOT Phase 091 BDD-2 — AI summarizer (extractive, offline, watermarked)
// Canonical: apps/backend/src/modules/ai-rag/services/ai-summarizer.service.ts
// - RISK_CALL: extractive summarizer (top-similarity sentences, Thai-safe)
//   — zero new deps, no external LLM egress (Gate 6). A provider seam
//   (LlmPort) allows swapping to a managed model without touching callers.
// - Every answer carries an invisible forensic watermark tag (§8.1).
// - Port-based for DB-free tests.
import { Injectable } from '@nestjs/common';
import { capExcerpt, watermarkTag } from '@repo/shared';
import { RagContextBuilderService } from './rag-context-builder.service';

export interface LlmPort {
  complete(prompt: string): Promise<string>;
}

function topSentences(text: string, max = 3): string[] {
  const sentences = text
    .split(/(?<=[.!?।。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const scored = sentences.map((s) => ({
    s,
    score: s.length + (s.includes('คือ') || s.includes('หมายถึง') ? 40 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.s);
}

@Injectable()
export class AiSummarizerService {
  constructor(
    private readonly context: RagContextBuilderService,
    private readonly llm?: LlmPort,
  ) {}

  async ask(args: {
    tenantId: string;
    productId: string;
    userIdHash: string;
    userQuestion: string;
    currentPage?: number;
  }): Promise<{ answer: string; referencedPages: number[] }> {
    const built = await this.context.build({
      tenantId: args.tenantId,
      productId: args.productId,
      userQuestion: args.userQuestion,
    });
    if (built.chunks.length === 0) {
      return {
        answer: `ไม่พบเนื้อหาที่เกี่ยวข้องในเล่มนี้ ${watermarkTag(args.userIdHash)}`,
        referencedPages: [],
      };
    }
    let body: string;
    if (this.llm) {
      body = await this.llm.complete(built.prompt);
    } else {
      const joined = built.chunks.map((c) => c.contentText).join(' ');
      body = `สรุปจากเนื้อหา: ${topSentences(joined, 3).join(' ')}`;
    }
    const referencedPages = [...new Set(built.chunks.map((c) => c.pageNumber).filter((p): p is number => typeof p === 'number'))];
    const pageRef = referencedPages.length > 0 ? ` (อ้างอิงหน้า ${referencedPages.join(', ')})` : '';
    return {
      answer: capExcerpt(`${body}${pageRef} ${watermarkTag(args.userIdHash)}`, 900),
      referencedPages,
    };
  }
}
