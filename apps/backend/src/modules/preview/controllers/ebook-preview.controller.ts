// SSOT Phase 051 §5.1 — ebook preview REST (public; gatekeeper returns 403 past page 10)
// Canonical: apps/backend/src/modules/preview/controllers/ebook-preview.controller.ts
// (legacy src/backend/modules/reader/preview-reader.controller.ts —
//  consolidated here per the §5.1 preview module tree; no logic fork.)
// - Preview is intentionally PUBLIC (unauthenticated trial): identity is
//   JWT if present, else x-user-id / x-line-user-id headers, else anon.
// - Structural Req types (no fastify import) per Phase 043 precedent.
import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { PreviewAccessCheckSchema, PreviewEventInputSchema } from '@repo/shared';
import { previewIdentityOf, type PreviewHttpReq } from '../preview-identity';
import { EbookChunkService } from '../services/ebook-chunk.service';
import { PreviewGatekeeperService } from '../services/preview-gatekeeper.service';

@Controller('api/v1/preview/ebook')
export class EbookPreviewController {
  constructor(
    private readonly chunks: EbookChunkService,
    private readonly gate: PreviewGatekeeperService,
  ) {}

  @Get('chunk')
  async chunk(
    @Query('productId') productId: string | undefined,
    @Query('page') page: string | undefined,
    @Req() req: PreviewHttpReq,
  ) {
    const parsed = PreviewAccessCheckSchema.safeParse({
      productId,
      contentType: 'EBOOK',
      targetPage: page ? Number(page) : undefined,
    });
    if (!parsed.success || !parsed.data.targetPage) {
      throw new BadRequestException('Invalid preview chunk request');
    }
    return this.chunks.getPreviewChunk(previewIdentityOf(req), parsed.data.productId, parsed.data.targetPage);
  }

  @Post('events')
  async events(@Body() body: Record<string, unknown>, @Req() req: PreviewHttpReq) {
    const parsed = PreviewEventInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid preview event');
    return { recorded: await this.gate.recordPreviewEvent(previewIdentityOf(req), parsed.data) };
  }
}
