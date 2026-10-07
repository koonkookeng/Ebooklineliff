// SSOT Phase 039 Task 39.5 — Fastify edge chunk controller
// Canonical: apps/backend/src/modules/reader/controllers/reader-chunk.controller.ts
// (legacy src/backend/modules/reader/controllers/reader-chunk.controller.ts)
// - GET /api/reader/chunk?tenantId=&productId=&page= — public LIFF read path
//   (canvas must render without an auth round-trip); Zod-gated boundary.
//   HIT → 200 payload; MISS → R2 warm → 200; total miss → 404 (client falls
//   back to IndexedDB per the 5-state machine).
// - DELETE /api/reader/chunk?tenantId=&productId= — JWT-guarded author/admin
//   publish path; instant cluster-wide invalidation (BDD-3, <100ms budget).
// - Zero new deps.
import { BadRequestException, Controller, Delete, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { ChunkCacheKeyParamsSchema } from '@repo/shared';
import { ChunkWarmerService } from '../cache/services/chunk-warmer.service';
import { RedisEdgeService } from '../cache/services/redis-edge.service';

function parseChunkQuery(query: Record<string, unknown>, fallbackPage = Number.NaN) {
  const parsed = ChunkCacheKeyParamsSchema.safeParse({
    tenantId: query['tenantId'],
    productId: query['productId'],
    pageNumber: Number(query['page'] ?? query['pageNumber'] ?? fallbackPage),
  });
  if (!parsed.success) throw new BadRequestException('Invalid chunk key params');
  return parsed.data;
}

@Controller('api/reader/chunk')
export class ReaderChunkController {
  constructor(
    private readonly edge: RedisEdgeService,
    private readonly warmer: ChunkWarmerService,
  ) {}

  @Get()
  async getChunk(@Query() query: Record<string, unknown>) {
    const params = parseChunkQuery(query);
    const payload = await this.warmer.getOrWarm(params);
    if (!payload) throw new NotFoundException('Chunk not available');
    return payload;
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async invalidate(@Query() query: Record<string, unknown>) {
    const params = parseChunkQuery(query, 1);
    const evicted = await this.edge.invalidateEbookCache(params.tenantId, params.productId);
    return { ok: true, evicted };
  }
}
