// SSOT Phase 061 §5.1 — DrmChunkController (scrambled chunk + trap audit)
// Canonical: apps/backend/src/modules/reader/drm/drm-chunk.controller.ts
// - GET  /api/reader/drm-chunk?productId=&page=&gridX=&gridY=&algorithm=
//   (JWT, entitlement-gated → 60s scrambled blob URL + matrix + watermark).
// - POST /api/reader/drm-violation (JWT, Zod-gated, single insert ≤500ms).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { CanvasShufflingService } from './canvas-shuffling.service';
import { DrmChunkRequestSchema, DrmViolationReportSchema } from './dto/drm-chunk-request.dto';

interface DrmReq {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function drmUserId(req: DrmReq): string {
  if (!req.user?.id) throw new BadRequestException('Missing session identity');
  return req.user.id;
}

function drmIp(req: DrmReq): string {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

@Controller('api/reader')
export class DrmChunkController {
  constructor(private readonly shuffling: CanvasShufflingService) {}

  @Get('drm-chunk')
  @UseGuards(JwtAuthGuard)
  async getChunk(@Query() query: Record<string, unknown>, @Req() req: DrmReq) {
    const parsed = DrmChunkRequestSchema.safeParse({
      productId: query['productId'],
      pageNumber: query['page'] ?? query['pageNumber'],
      gridX: query['gridX'],
      gridY: query['gridY'],
      algorithm: query['algorithm'],
    });
    if (!parsed.success) throw new BadRequestException('Invalid DRM chunk params');
    return this.shuffling.getDrmChunk(
      drmUserId(req),
      parsed.data.productId,
      parsed.data.pageNumber,
      parsed.data.gridX,
      parsed.data.gridY,
      parsed.data.algorithm,
      drmIp(req),
    );
  }

  @Post('drm-violation')
  @UseGuards(JwtAuthGuard)
  async reportViolation(@Body() body: Record<string, unknown>, @Req() req: DrmReq) {
    const parsed = DrmViolationReportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid violation report');
    return this.shuffling.reportViolation(drmUserId(req), parsed.data, drmIp(req));
  }
}
