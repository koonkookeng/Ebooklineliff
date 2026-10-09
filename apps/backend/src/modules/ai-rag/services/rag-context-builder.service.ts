// SSOT Phase 091 BDD-2/Task 6 — RAG context builder (retrieve → prompt)
// Canonical: apps/backend/src/modules/ai-rag/services/rag-context-builder.service.ts
// - Retrieves top-K tenant-isolated chunks (book-scoped), caps each excerpt
//   at 300 chars (DRM §8.1), assembles a grounded Thai prompt with page
//   references. No external LLM calls here (builder only).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { AI_EXCERPT_MAX_CHARS, capExcerpt } from '@repo/shared';
import { EmbeddingGeneratorService } from '../../vector-search/services/embedding-generator.service';
import { PgVectorRepositoryService } from '../../vector-search/services/pgvector-repository.service';

export interface RagChunk {
  chunkIndex: number;
  contentText: string;
  similarity: number;
  pageNumber?: number;
}

@Injectable()
export class RagContextBuilderService {
  constructor(
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly vectors: PgVectorRepositoryService,
  ) {}

  async build(args: {
    tenantId: string;
    productId: string;
    userQuestion: string;
    limit?: number;
  }): Promise<{ prompt: string; chunks: RagChunk[]; excerptChars: number }> {
    const queryVector = await this.embeddings.embed(args.userQuestion);
    const rows = await this.vectors.searchSimilarVectors(
      queryVector,
      0.0,
      args.limit ?? 4,
      args.tenantId,
      args.productId,
    );
    const chunks: RagChunk[] = rows.map((r) => {
      const meta = (r.metadata_json ?? {}) as { pageNumber?: number };
      const chunk: RagChunk = {
        chunkIndex: r.chunk_index,
        contentText: capExcerpt(r.content_text),
        similarity: r.similarity,
      };
      if (typeof meta.pageNumber === 'number') chunk.pageNumber = meta.pageNumber;
      return chunk;
    });
    const excerptChars = chunks.reduce((n, c) => n + c.contentText.length, 0);
    const context = chunks
      .map((c, i) => `[${i + 1}]${c.pageNumber != null ? ` (หน้า ${c.pageNumber})` : ''} ${c.contentText}`)
      .join('\n');
    const prompt =
      `ตอบคำถามต่อไปนี้โดยใช้เฉพาะเนื้อหาอ้างอิง (ไม่อ้างเกิน ${AI_EXCERPT_MAX_CHARS} ตัวอักษรต่อ excerpt) ` +
      `และระบุเลขหน้าที่อ้างอิงทุกครั้ง\nคำถาม: ${args.userQuestion}\nเนื้อหาอ้างอิง:\n${context}`;
    return { prompt, chunks, excerptChars };
  }
}
