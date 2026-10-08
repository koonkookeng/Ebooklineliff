// SSOT Phase 058 §5.1 — ScrubbingController (manifest + analytics REST)
// Canonical: apps/backend/src/modules/stream/controllers/scrubbing.controller.ts
// - GET  /api/v1/stream/scrubbing-manifest?lessonId= (JWT, entitlement-gated)
// - POST /api/v1/stream/scrubbing-analytics {lessonId,targetTimeSec} (JWT, 202)
// - Zod-gated inputs; 403/404 map to the ERROR timestamp-only fallback.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { ScrubbingManifestInputSchema } from '@repo/shared';
import { ThumbnailScrubbingService } from '../services/thumbnail-scrubbing.service';

interface ScrubReq {
  user?: { id?: string };
}

function identityOf(req: ScrubReq): string {
  if (!req.user?.id) throw new BadRequestException('Missing session identity');
  return req.user.id;
}

@Controller('api/v1/stream')
export class ScrubbingController {
  constructor(private readonly scrubbing: ThumbnailScrubbingService) {}

  @Get('scrubbing-manifest')
  @UseGuards(JwtAuthGuard)
  async getManifest(@Req() req: ScrubReq, @Query('lessonId') lessonId: string) {
    const parsed = ScrubbingManifestInputSchema.safeParse({ lessonId });
    if (!parsed.success) throw new BadRequestException('Invalid lessonId');
    const { manifest, watermarkText } = await this.scrubbing.getScrubbingManifest(identityOf(req), parsed.data.lessonId);
    return { success: true, manifest, watermarkText };
  }

  @Post('scrubbing-analytics')
  @UseGuards(JwtAuthGuard)
  async trackSeek(@Req() req: ScrubReq, @Body() body: { lessonId?: string; targetTimeSec?: number }) {
    const parsed = ScrubbingManifestInputSchema.safeParse({ lessonId: body?.lessonId });
    if (!parsed.success) throw new BadRequestException('Invalid lessonId');
    const target = Number(body?.targetTimeSec);
    if (!Number.isFinite(target) || target < 0) throw new BadRequestException('Invalid targetTimeSec');
    await this.scrubbing.trackScrubSeek(identityOf(req), parsed.data.lessonId, target);
    return { recorded: true };
  }
}
