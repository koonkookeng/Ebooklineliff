// SSOT Phase 042 — WatermarkController (seed + violation REST for LIFF)
// Canonical: apps/backend/src/modules/watermark/infrastructure/rest/watermark.controller.ts
// - GET /api/v1/watermark/seed?productId= — JWT; same handler as GQL.
// - POST /api/v1/watermark/violation {violationType, metadata} — JWT; BDD-2
//   tamper sink: persists SecurityViolationLog async + emits
//   security.tamper_detected (client blanks the canvas itself).
// - Identity via req.user (JwtAuthGuard); IP from x-forwarded-for.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { WatermarkViolationTypeEnum } from '@repo/shared';
import { GetWatermarkSeedHandler } from '../../application/queries/get-watermark-seed.handler';
import { WatermarkSeedRepository } from '../repositories/watermark-seed.repository';

interface WatermarkReq {
  user?: { id?: string; lineUserId?: string | null };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function identityOf(req: WatermarkReq): { userId: string; lineUserId?: string } {
  if (!req.user?.id) throw new BadRequestException('Missing session identity');
  return { userId: req.user.id, lineUserId: req.user.lineUserId ?? undefined };
}

function ipOf(req: WatermarkReq): string {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

@Controller('api/v1/watermark')
export class WatermarkController {
  constructor(
    private readonly seeds: GetWatermarkSeedHandler,
    private readonly repo: WatermarkSeedRepository,
  ) {}

  @Get('seed')
  @UseGuards(JwtAuthGuard)
  async seed(@Query('productId') productId: string | undefined, @Req() req: WatermarkReq) {
    if (!productId) throw new BadRequestException('Missing product id');
    const { userId, lineUserId } = identityOf(req);
    return this.seeds.execute({
      userId,
      lineUserId,
      displayName: lineUserId ?? `reader-${userId.slice(0, 8)}`,
      productId,
      clientIp: ipOf(req),
      userAgent: req.headers?.['user-agent'] ?? 'liff-webview',
    });
  }

  @Post('violation')
  @UseGuards(JwtAuthGuard)
  async violation(@Body() body: Record<string, unknown>, @Req() req: WatermarkReq) {
    const parsed = WatermarkViolationTypeEnum.safeParse(body['violationType']);
    if (!parsed.success) throw new BadRequestException('Invalid violation type');
    const { userId, lineUserId } = identityOf(req);
    const metadata = (body['metadata'] as Record<string, unknown>) ?? {};
    await this.repo.logViolation({
      userId,
      lineUserId,
      violationType: parsed.data,
      metadata: { ...metadata, reportedAt: new Date().toISOString() },
      ipAddress: ipOf(req),
    });
    return { recorded: true };
  }
}
