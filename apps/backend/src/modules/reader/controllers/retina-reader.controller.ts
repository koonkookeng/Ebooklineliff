// SSOT Phase 060 Task 2/4 — RetinaReaderController (DPR variant chunk REST)
// Canonical: apps/backend/src/modules/reader/controllers/retina-reader.controller.ts
// (legacy src/backend/modules/reader/controllers/retina-reader.controller.ts)
// - GET /api/reader/retina-chunk?productId=&page=&deviceDpr=&cssWidth=&cssHeight=
//   Public LIFF read path (chunk-controller precedent: canvas renders without
//   an auth round-trip); Zod-gated boundary; MISS → 404 (client IDB fallback).
// - Identity is best-effort (header > anonymous watermark) mirroring the
//   preview-identity precedent; entitled full-content gating stays in
//   ReaderService — OUT_OF_SCOPE_STRICT respected.
// - Zero new deps.
import { BadRequestException, Controller, Get, NotFoundException, Query, Req } from '@nestjs/common';
import { RetinaChunkQuerySchema } from '../dto/canvas-scaler.dto';
import { VectorChunkService } from '../services/vector-chunk.service';

interface RetinaReq {
  headers?: Record<string, string | undefined>;
}

@Controller('api/reader/retina-chunk')
export class RetinaReaderController {
  constructor(private readonly vectors: VectorChunkService) {}

  @Get()
  async getRetinaChunk(@Query() query: Record<string, unknown>, @Req() req: RetinaReq) {
    const parsed = RetinaChunkQuerySchema.safeParse({
      productId: query['productId'],
      pageNumber: query['page'] ?? query['pageNumber'],
      deviceDpr: query['deviceDpr'] ?? query['dpr'],
      cssWidth: query['cssWidth'] ?? query['width'],
      cssHeight: query['cssHeight'] ?? query['height'],
    });
    if (!parsed.success) throw new BadRequestException('Invalid retina chunk params');
    const userId = req.headers?.['x-user-id'] ?? '00000000-0000-0000-0000-000000000000';
    const payload = await this.vectors
      .getRetinaChunk(parsed.data.productId, parsed.data.pageNumber, parsed.data.deviceDpr, userId)
      .catch(() => null);
    if (!payload) throw new NotFoundException('Chunk not available');
    return payload;
  }
}
