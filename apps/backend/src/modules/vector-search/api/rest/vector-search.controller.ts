// SSOT Phase 091 — Vector search REST (JWT search/ask + seller ingest)
// Canonical: apps/backend/src/modules/vector-search/api/rest/vector-search.controller.ts
// - POST search (member JWT) / POST ask (member JWT + entitlement) /
//   POST ingest (seller JWT, chunked server-side).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { chunkText } from '@repo/shared';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { SemanticSearchService } from '../../services/semantic-search.service';
import { EmbeddingGeneratorService } from '../../services/embedding-generator.service';
import { PgVectorRepositoryService } from '../../services/pgvector-repository.service';
import { AiSummarizerService } from '../../../ai-rag/services/ai-summarizer.service';
import { EntitlementGrantService } from '../../../entitlement/services/entitlement-grant.service';
import { PrismaService } from '../../../../infra/database/prisma.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { userId: string; tenantId: string } {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const tenantId = ((req as { tenantId?: string }).tenantId ?? (req['headers'] as Record<string, string> | undefined)?.['x-tenant-id'] ?? '').trim();
  if (!user.id) throw new BadRequestException('Missing authentication');
  if (!tenantId) throw new BadRequestException('Missing tenant scope');
  return { userId: user.id, tenantId };
}

@Controller('api/v1/vector-search')
@UseGuards(JwtAuthGuard, TenantGuard)
export class VectorSearchController {
  constructor(
    private readonly search: SemanticSearchService,
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly vectors: PgVectorRepositoryService,
    private readonly summarizer: AiSummarizerService,
    private readonly grants: EntitlementGrantService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('search')
  searchSemantic(@Req() req: LooseReq, @Body() body: unknown) {
    const { tenantId } = actorOf(req);
    return this.search.execute({ ...((body ?? {}) as object), tenantId } as never);
  }

  @Post('ask')
  async askBook(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, tenantId } = actorOf(req);
    const b = (body ?? {}) as { productId?: string; userQuestion?: string; currentPage?: number };
    if (!b.productId || !b.userQuestion) throw new BadRequestException('Missing productId/userQuestion');
    const ok = await this.grants.hasAccess(this.prisma as never, userId, b.productId);
    if (!ok) throw new ForbiddenException('Entitlement required for this product');
    return this.summarizer.ask({
      tenantId,
      productId: b.productId,
      userIdHash: createHash('sha256').update(userId).digest('hex').slice(0, 12),
      userQuestion: b.userQuestion,
      currentPage: b.currentPage,
    });
  }

  @Post('ingest')
  async ingest(@Req() req: LooseReq, @Body() body: unknown) {
    const { tenantId } = actorOf(req);
    const b = (body ?? {}) as {
      productId?: string; sourceType?: string; sourceId?: string; contentText?: string; pageNumber?: number;
    };
    if (!b.productId || !b.sourceType || !b.sourceId || !b.contentText) {
      throw new BadRequestException('Missing ingest fields');
    }
    let count = 0;
    for (const chunk of chunkText(b.contentText)) {
      await this.vectors.saveVectorEmbedding({
        tenantId,
        productId: b.productId,
        sourceType: b.sourceType,
        sourceId: b.sourceId,
        chunkIndex: count++,
        contentText: chunk,
        embedding: await this.embeddings.embed(chunk),
        metadataJson: b.pageNumber != null ? { pageNumber: b.pageNumber } : {},
      });
    }
    return { ingested: count };
  }
}
