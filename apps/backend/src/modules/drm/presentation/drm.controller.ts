// SSOT Phase 049 — DrmController (LIFF REST transport parity)
// Canonical: apps/backend/src/modules/drm/presentation/drm.controller.ts
// - POST /api/v1/drm/session (JWT, entitlement-gated grant)
// - GET  /api/v1/drm/chunk?productId=&pageNumber=&sessionId= (JWT, scrape-guarded)
// - POST /api/v1/drm/violation (JWT, anti-piracy audit <500ms)
// - Same services as GQL (no HTTP hop between transports).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { DrmViolationTypeEnum } from '@repo/shared';
import { DrmSessionService } from '../services/drm-session.service';
import { resolveReaderIdentity } from '../../reader/reader-identity';

interface DrmReq {
  user?: { id?: string; tenantId?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function clientIpOf(req: DrmReq): string {
  return req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

@Controller('api/v1/drm')
export class DrmController {
  constructor(private readonly sessions: DrmSessionService) {}

  @Post('session')
  @UseGuards(JwtAuthGuard)
  async initSession(@Body() body: Record<string, unknown>, @Req() req: DrmReq) {
    const { userId } = resolveReaderIdentity({ req });
    const productId = typeof body.productId === 'string' ? body.productId : '';
    const pageNumber = typeof body.pageNumber === 'number' ? body.pageNumber : Number(body.pageNumber);
    const imageWidth = typeof body.imageWidth === 'number' ? body.imageWidth : 1024;
    const imageHeight = typeof body.imageHeight === 'number' ? body.imageHeight : 1400;
    if (!productId || !Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('productId and positive pageNumber required');
    }
    return this.sessions.initDrmSession({
      userId,
      productId,
      pageNumber,
      tenantId: req.headers?.['x-tenant-id'],
      imageWidth,
      imageHeight,
    });
  }

  @Get('chunk')
  @UseGuards(JwtAuthGuard)
  async getChunk(
    @Query('productId') productId: string,
    @Query('pageNumber') pageNumber: string,
    @Query('sessionId') sessionId: string,
    @Req() req: DrmReq,
  ) {
    const { userId } = resolveReaderIdentity({ req });
    const page = Number(pageNumber);
    if (!productId || !sessionId || !Number.isInteger(page) || page < 1) {
      throw new BadRequestException('productId, pageNumber and sessionId required');
    }
    return this.sessions.getDrmChunk({
      productId,
      pageNumber: page,
      sessionId,
      userId,
      tenantId: req.headers?.['x-tenant-id'],
      ipAddress: clientIpOf(req),
    });
  }

  @Post('violation')
  @UseGuards(JwtAuthGuard)
  async reportViolation(@Body() body: Record<string, unknown>, @Req() req: DrmReq) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const violationType = typeof body.violationType === 'string' ? body.violationType : '';
    if (!sessionId || !DrmViolationTypeEnum.safeParse(violationType).success) {
      throw new BadRequestException('sessionId and valid violationType required');
    }
    const ok = await this.sessions.reportViolation({
      sessionId,
      violationType,
      ipAddress: clientIpOf(req),
      userAgent: req.headers?.['user-agent'] ?? 'unknown',
      metadata:
        body.metadata && typeof body.metadata === 'object'
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });
    return { success: ok };
  }
}
