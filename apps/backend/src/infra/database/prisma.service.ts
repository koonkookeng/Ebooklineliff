// SSOT Phase 002 §5/§7 — Prisma service with pool lifecycle + vector search
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('PostgreSQL 16 connected (pgvector ready).');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Vector similarity search (Cosine Distance) for AI recommendations
  async searchSimilarEbookChapters(queryVector: number[], topK = 5) {
    const vectorString = `[${queryVector.join(',')}]`;
    return await this.$queryRawUnsafe<
      { id: string; content_type: string; reference_id: string; chunk_index: number; similarity: number }[]
    >(
      `SELECT id, content_type, reference_id, chunk_index,
              1 - (embedding <=> $1::vector) AS similarity
       FROM content_vector_embeddings
       ORDER BY embedding <=> $1::vector
       LIMIT $2;`,
      vectorString,
      topK,
    );
  }
}
