// SSOT Phase 103 Task 2 — RAG Search Service (pgvector + deterministic embeddings)
// Canonical: apps/backend/src/modules/ai-bot/application/rag-search.service.ts
// - Embed query → pgvector cosine search (tenant-isolated) →
//   return best answer + confidence + suggested actions.
//   <1.2s SLA (BDD §1.2). Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { ESCALATION_CONFIDENCE_THRESHOLD } from '@repo/shared';

export interface RAGEmbeddingPort {
  embed(text: string): Promise<number[]>;
}

export interface RAGVectorPort {
  queryRawUnsafe<T>(sql: string, ...args: Array<string | number | null>): Promise<T>;
}

export interface RAGSuggestedAction {
  label: string;
  actionUrl?: string;
  intentCode?: string;
}

export interface RAGResult {
  answerText: string;
  confidenceScore: number;
  suggestedActions: RAGSuggestedAction[];
  shouldEscalateToHuman: boolean;
  sources: Array<{ id: string; question: string; similarity: number }>;
}

interface KBHit {
  id: string;
  question: string;
  answer: string;
  similarity: number;
}

@Injectable()
export class RAGSearchService {
  private readonly defaultTenantId = 'default';

  constructor(
    private readonly embeddings: RAGEmbeddingPort,
    private readonly vectors: RAGVectorPort,
  ) {}

  async queryKnowledgeBase(query: string, tenantId?: string): Promise<RAGResult> {
    const vector = await this.embeddings.embed(query);
    // pgvector wire format (091 precedent): "[0.1,0.2,...]" as text param.
    const vectorString = `[${vector.join(',')}]`;
    const results = await this.vectors.queryRawUnsafe<KBHit[]>(
      `SELECT id, question, answer, 1 - (embedding <=> $1) AS similarity
       FROM "KnowledgeBaseVector"
       WHERE tenantId = $2 AND isPublished = true
       ORDER BY embedding <=> $1
       LIMIT 5`,
      vectorString,
      tenantId ?? this.defaultTenantId,
    );

    if (results.length === 0 || results[0].similarity < 0.5) {
      return this.fallbackResult();
    }

    const top = results[0];
    const confidence = Math.min(top.similarity, 1);
    const shouldEscalate = confidence < ESCALATION_CONFIDENCE_THRESHOLD;

    return {
      answerText: top.answer,
      confidenceScore: confidence,
      suggestedActions: this.buildActions(top.question),
      shouldEscalateToHuman: shouldEscalate,
      sources: results.map((r: KBHit) => ({ id: r.id, question: r.question, similarity: r.similarity })),
    };
  }

  private fallbackResult(): RAGResult {
    return {
      answerText: 'ขออภัยครับ ผมไม่พบคำตอบที่ตรงกับคำถามของคุณในขณะนี้',
      confidenceScore: 0,
      suggestedActions: [
        { label: 'สร้างตั๋วสนับสนุน', intentCode: 'CREATE_TICKET' },
        { label: 'คุยกับเจ้าหน้าที่', intentCode: 'ESCALATE' },
      ],
      shouldEscalateToHuman: true,
      sources: [],
    };
  }

  private buildActions(question: string): RAGSuggestedAction[] {
    const base: RAGSuggestedAction[] = [
      { label: 'ดูคำถามที่เกี่ยวข้อง', intentCode: 'RELATED_Q' },
      { label: 'ไม่ใช่คำตอบที่ต้องการ', intentCode: 'NOT_HELPFUL' },
    ];
    if (question.includes('E-Book') || question.includes('อ่าน')) {
      base.unshift({ label: 'รีเซ็ตสิทธิ์การอ่าน', intentCode: 'RESET_ENTITLEMENT', actionUrl: '/my-library' });
    }
    if (question.includes('ชำระเงิน') || question.includes('สลิป')) {
      base.unshift({ label: 'เช็กสถานะการชำระเงิน', intentCode: 'CHECK_PAYMENT', actionUrl: '/orders' });
    }
    return base;
  }
}
