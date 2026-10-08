// SSOT Phase 053 Task 3 — signed-URL gateway (JWT, Zod edge, 403 on no grant)
// Canonical: apps/backend/src/modules/stream/hls-stream.controller.ts
// (legacy src/backend/modules/stream/hls-stream.controller.ts)
// - GET /api/stream/get-signed-url?lessonId=&quality= → 200 signed playlist
//   bundle (<10ms mint SLA on the hot path; entitlement flag is edge-cached).
// - Distinct from the Phase 050 api/v1/hls controller (different prefix, no
//   route collision). Carries Nest decorators → static parity verified.
import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { GenerateHlsTokenInputSchema } from '@repo/shared';
import { resolveClientIp } from './dto/hls-token.dto';
import { HlsTokenGeneratorService } from './hls-token-generator.service';
import { HlsEntitlementGuard } from './guards/hls-entitlement.guard';

interface SignedUrlReq {
  user?: { id?: string; displayName?: string };
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

@Controller('api/stream')
export class HlsSignedStreamController {
  constructor(private readonly tokens: HlsTokenGeneratorService) {}

  @Get('get-signed-url')
  @UseGuards(JwtAuthGuard, HlsEntitlementGuard)
  async getSignedUrl(@Query('lessonId') lessonId: string, @Req() req: SignedUrlReq) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Missing stream identity');
    const parsed = GenerateHlsTokenInputSchema.safeParse({ lessonId });
    if (!parsed.success) {
      throw new ForbiddenException('Invalid lesson scope');
    }
    const clientIp = resolveClientIp(req.headers, req.ip ?? req.socket?.remoteAddress ?? '');
    const userAgent = String(req.headers['user-agent'] ?? '');
    return this.tokens.getSignedMasterPlaylist(
      userId,
      parsed.data.lessonId,
      clientIp,
      userAgent,
      req.user?.displayName ?? 'member',
    );
  }
}
