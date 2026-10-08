// SSOT Phase 067 Task 2 — QualityManifestController (manifest + telemetry)
// Canonical: apps/backend/src/modules/stream/quality/quality-manifest.controller.ts
// (legacy src/backend/modules/stream/stream.controller.ts mapping)
// - GET /api/v1/stream/quality-manifest?lessonId= (JWT, entitlement-gated).
// - POST /api/v1/stream/telemetry { ...StreamTelemetryPayload } (JWT,
//   Zod-gated, fire-and-forget ledger).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { QualitySelectorService } from './quality-selector.service';

interface QualityReq {
  user?: { id?: string };
}

@Controller('api/v1/stream')
export class QualityManifestController {
  constructor(private readonly quality: QualitySelectorService) {}

  @Get('quality-manifest')
  @UseGuards(JwtAuthGuard)
  async manifest(@Query('lessonId') lessonId: string, @Req() req: QualityReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    if (!lessonId) throw new BadRequestException('lessonId required');
    const res = await this.quality.getQualityManifest(userId, String(lessonId));
    if (!res.ok || !res.manifest) throw new BadRequestException(res.error ?? 'MANIFEST_FAILED');
    return res.manifest;
  }

  @Post('telemetry')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  async telemetry(@Body() body: Record<string, unknown>, @Req() req: QualityReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.quality.reportTelemetry(userId, body ?? {});
  }
}
