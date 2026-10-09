// SSOT Phase 092 BDD-1 — Companion summarizer (chat orchestration + atomic history)
// Canonical: apps/backend/src/modules/ai-companion/services/summarizer.service.ts
// - Flow: Zod gate → injection sanitize → entitlement-checked upstream →
//   retrieve (DRM-capped) → orchestrate (cache/fallback) → ONE $transaction:
//   session ensure + USER/AI messages (Gate 7) → AiChatResponse.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiChatQuerySchema, AiSummaryRequestSchema, AI_STREAM, estimateTokens } from '@repo/shared';
import { RagRetrievalService } from './rag-retrieval.service';
import { LlmOrchestratorService } from './llm-orchestrator.service';

export interface ChatTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface ChatStorePort {
  ensureSession(tx: unknown, userId: string, productId: string): Promise<{ id: string }>;
  createMessage(
    tx: unknown,
    args: { sessionId: string; sender: string; content: string; citationsJson?: unknown; promptTokens: number; completionTokens: number },
  ): Promise<{ id: string }>;
}

export interface CompanionBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class CompanionSummarizerService {
  constructor(
    private readonly retrieval: RagRetrievalService,
    private readonly orchestrator: LlmOrchestratorService,
    private readonly store: ChatStorePort,
    private readonly tx: ChatTx,
    private readonly bus?: CompanionBus,
  ) {}

  async chat(args: {
    userId: string;
    tenantId: string;
    userIdHash: string;
    query: { sessionId?: string; productId: string; userQuestion: string; currentPage?: number; currentLessonSec?: number };
  }): Promise<{ sessionId: string; messageId: string; answerMarkdown: string; citations: Array<{ pageNumber?: number; timestampSec?: number; snippetText: string }>; tokenUsed: number }> {
    const parsed = AiChatQuerySchema.safeParse(args.query);
    if (!parsed.success) throw new BadRequestException('Invalid AI chat query');
    const t0 = Date.now();

    const chunks = await this.retrieval.retrieve({
      tenantId: args.tenantId,
      productId: parsed.data.productId,
      question: parsed.data.userQuestion,
    });
    const out = await this.orchestrator.answer({
      tenantId: args.tenantId,
      productId: parsed.data.productId,
      userIdHash: args.userIdHash,
      question: parsed.data.userQuestion,
      chunks,
      currentPage: parsed.data.currentPage,
    });

    const saved = await this.tx.run(async (tx) => {
      const session = parsed.data.sessionId
        ? { id: parsed.data.sessionId }
        : await this.store.ensureSession(tx, args.userId, parsed.data.productId);
      await this.store.createMessage(tx, {
        sessionId: session.id,
        sender: 'USER',
        content: parsed.data.userQuestion,
        promptTokens: estimateTokens(parsed.data.userQuestion),
        completionTokens: 0,
      });
      const ai = await this.store.createMessage(tx, {
        sessionId: session.id,
        sender: 'AI',
        content: out.answer,
        citationsJson: out.citations,
        promptTokens: 0,
        completionTokens: out.tokenUsed,
      });
      return { sessionId: session.id, messageId: ai.id };
    });

    await this.bus
      ?.xadd(AI_STREAM, {
        event: 'ai_chat_answered',
        sessionId: saved.sessionId,
        productId: parsed.data.productId,
        ttftMs: out.ttftMs,
        tookMs: Date.now() - t0,
        at: Date.now(),
      })
      .catch(() => undefined);
    return {
      sessionId: saved.sessionId,
      messageId: saved.messageId,
      answerMarkdown: out.answer,
      citations: out.citations,
      tokenUsed: out.tokenUsed,
    };
  }

  async summarize(args: {
    userId: string;
    tenantId: string;
    userIdHash: string;
    request: { productId: string; sourceType: string; targetPage?: number; lessonId?: string; language?: string };
  }): Promise<{ summary: string; citations: Array<{ pageNumber?: number; timestampSec?: number; snippetText: string }> }> {
    const parsed = AiSummaryRequestSchema.safeParse(args.request);
    if (!parsed.success) throw new BadRequestException('Invalid AI summary request');
    const prompt =
      parsed.data.sourceType === 'COURSE_LESSON_TRANSCRIPT'
        ? 'สรุปบทเรียนนี้ใน 5 ประเด็น'
        : parsed.data.targetPage != null
          ? `สรุปเนื้อหาหน้า ${parsed.data.targetPage} ใน 3 ประโยค`
          : 'สรุปแนวคิดสำคัญของเนื้อหานี้ใน 3 ประโยค';
    const chunks = await this.retrieval.retrieve({
      tenantId: args.tenantId,
      productId: parsed.data.productId,
      question: prompt,
    });
    const out = await this.orchestrator.answer({
      tenantId: args.tenantId,
      productId: parsed.data.productId,
      userIdHash: args.userIdHash,
      question: prompt,
      chunks,
      currentPage: parsed.data.targetPage,
    });
    return { summary: out.answer, citations: out.citations };
  }

  // Fallback UUID helper (test seam keeps Node 20 compat without extra deps).
  newId(): string {
    return randomUUID();
  }
}
