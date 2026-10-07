// SSOT Phase 026 Task 2 — Social share REST controller (JWT-guarded)
// Canonical: apps/backend/src/modules/social-share/controllers/social-share.controller.ts
// (legacy src/backend/modules/social-share/controllers/social-share.controller.ts)
// - GET  /api/v1/social-share/flex?productId=&contentType=&targetPageNumber=&targetLessonId=&customQuote=
// - POST /api/v1/social-share/logs { productId, targetType, status, shareToken }
// - GET  /api/v1/social-share/preview?st= (public: viral preview gate, no auth)
import { BadRequestException, Controller, Get, Post, Body, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { SocialShareService } from '../services/social-share.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
  headers?: Record<string, string | string[] | undefined>;
}

function actor(req: AuthedReq): string {
  const id = req.user?.id;
  if (!id) throw new UnauthorizedException('Unauthorized');
  return id;
}

@Controller('api/v1/social-share')
export class SocialShareController {
  constructor(private readonly share: SocialShareService) {}

  @Get('flex')
  @UseGuards(JwtAuthGuard)
  flex(
    @Query('productId') productId: string | undefined,
    @Query('contentType') contentType: string | undefined,
    @Query('targetPageNumber') targetPageNumber: string | undefined,
    @Query('targetLessonId') targetLessonId: string | undefined,
    @Query('customQuote') customQuote: string | undefined,
    @Req() req: AuthedReq,
  ) {
    if (!productId || !contentType) throw new BadRequestException('Missing share input');
    return this.share.generateFlexSharePayload(actor(req), {
      productId,
      contentType,
      ...(targetPageNumber ? { targetPageNumber: Number.parseInt(targetPageNumber, 10) } : {}),
      ...(targetLessonId ? { targetLessonId } : {}),
      ...(customQuote ? { customQuote } : {}),
    });
  }

  @Post('logs')
  @UseGuards(JwtAuthGuard)
  recordLog(@Body() body: unknown, @Req() req: AuthedReq) {
    return this.share.recordShareLog(actor(req), body);
  }

  @Get('preview')
  preview(@Query('st') shareToken: string | undefined) {
    if (!shareToken) throw new BadRequestException('Missing share token');
    return this.share.trackShareClick(shareToken);
  }
}
