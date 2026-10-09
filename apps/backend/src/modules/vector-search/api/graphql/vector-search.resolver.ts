// SSOT Phase 091 Task 5 — Vector search GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/vector-search/api/graphql/vector-search.resolver.ts
// - Query.semanticSearch (tenant JWT) / Mutation.askAiAboutBook (entitlement
//   gated) / Mutation.ingestContentVectors (seller JWT, chunked).
// - RISK_CALL: ai-rag services are consumed here (spec §5.1 keeps ai-rag
//   tree service-only); entitlement reads reuse 012 grant service.
// - Zero new deps.
import { Args, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { chunkText } from '@repo/shared';
import { SemanticSearchService } from '../../services/semantic-search.service';
import { EmbeddingGeneratorService } from '../../services/embedding-generator.service';
import { PgVectorRepositoryService } from '../../services/pgvector-repository.service';
import { RagContextBuilderService } from '../../../ai-rag/services/rag-context-builder.service';
import { AiSummarizerService } from '../../../ai-rag/services/ai-summarizer.service';
import { EntitlementGrantService } from '../../../entitlement/services/entitlement-grant.service';
import { PrismaService } from '../../../../infra/database/prisma.service';
import {
  AiAskContextQueryInputGql,
  AiAskPayloadGql,
  SemanticSearchInputGql,
  SemanticSearchPayloadGql,
} from './vector-search.type';

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string | null; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  return { userId: user.id ?? null, tenantId };
}

function actorOf(ctx: LooseCtx): { userId: string; tenantId: string } {
  const { userId, tenantId } = ctxOf(ctx);
  if (!userId) throw new BadRequestException('Missing authentication');
  if (!tenantId) throw new BadRequestException('Missing tenant scope');
  return { userId, tenantId };
}

@Resolver('VectorSearch')
export class VectorSearchResolver {
  constructor(
    private readonly search: SemanticSearchService,
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly vectors: PgVectorRepositoryService,
    private readonly rag: RagContextBuilderService,
    private readonly summarizer: AiSummarizerService,
    private readonly grants: EntitlementGrantService,
    private readonly prisma: PrismaService,
  ) {}

  @Query('semanticSearch')
  semanticSearch(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const { tenantId } = actorOf(ctx);
    return this.search.execute({ ...(input as object), tenantId } as never);
  }

  @Mutation('askAiAboutBook')
  async askAiAboutBook(@Args('input') input: AiAskContextQueryInputGql, @Context() ctx: LooseCtx) {
    const { userId, tenantId } = actorOf(ctx);
    const ok = await this.grants.hasAccess(this.prisma as never, userId, input.productId);
    if (!ok) throw new ForbiddenException('Entitlement required for this product');
    const userIdHash = createHash('sha256').update(userId).digest('hex').slice(0, 12);
    const r = await this.summarizer.ask({
      tenantId,
      productId: input.productId,
      userIdHash,
      userQuestion: input.userQuestion,
      currentPage: input.currentPage ?? undefined,
    });
    const out = new AiAskPayloadGql();
    out.answer = r.answer;
    out.referencedPages = r.referencedPages;
    return out;
  }

  @Mutation('ingestContentVectors')
  async ingestContentVectors(
    @Args('productId') productId: string,
    @Args('sourceType') sourceType: string,
    @Args('sourceId') sourceId: string,
    @Args('contentText') contentText: string,
    @Args('pageNumber') pageNumber: number | null,
    @Context() ctx: LooseCtx,
  ): Promise<number> {
    const { tenantId } = actorOf(ctx);
    const chunks = chunkText(contentText);
    let idx = 0;
    for (const chunk of chunks) {
      const embedding = await this.embeddings.embed(chunk);
      await this.vectors.saveVectorEmbedding({
        tenantId,
        productId,
        sourceType,
        sourceId,
        chunkIndex: idx++,
        contentText: chunk,
        embedding,
        metadataJson: pageNumber != null ? { pageNumber } : {},
      });
    }
    return idx;
  }

  // Keep RAG builder reachable for module consumers (prompt inspection).
  buildRagPrompt(productId: string, userQuestion: string, ctx: LooseCtx) {
    const { tenantId } = actorOf(ctx);
    return this.rag.build({ tenantId, productId, userQuestion });
  }
}

export { SemanticSearchPayloadGql, AiAskPayloadGql };
