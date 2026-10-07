// SSOT Phase 041 Task 3 — ReaderControlController (annotation REST)
// Canonical: apps/backend/src/modules/reader/reader-control.controller.ts
// (legacy src/backend/modules/reader/reader-control.controller.ts)
// - JWT-guarded `api/v1/reader-control`: annotations GET, bookmark POST
//   (toggle), highlight POST/DELETE, preferences GET/PUT — all Zod-gated.
// - Identity from req.user (JwtAuthGuard); tenant never required here because
//   annotation keys are user-scoped, not tenant-scoped.
// - Zero new deps.
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import {
  CreateBookmarkInputSchema,
  CreateHighlightInputSchema,
  ReaderPreferenceSchema,
} from '@repo/shared';
import { ReaderControlService } from './reader-control.service';

interface ControlReq {
  user?: { id?: string };
}

function controlUserId(req: ControlReq): string {
  const userId = req.user?.id;
  if (!userId) throw new BadRequestException('Missing session identity');
  return userId;
}

@Controller('api/v1/reader-control')
export class ReaderControlController {
  constructor(private readonly controls: ReaderControlService) {}

  @Get('annotations')
  @UseGuards(JwtAuthGuard)
  async annotations(@Query('productId') productId: string | undefined, @Req() req: ControlReq) {
    if (!productId) throw new BadRequestException('Missing product id');
    return this.controls.getAnnotations(controlUserId(req), productId);
  }

  @Post('bookmark')
  @UseGuards(JwtAuthGuard)
  async toggleBookmark(@Body() body: Record<string, unknown>, @Req() req: ControlReq) {
    const parsed = CreateBookmarkInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid bookmark input');
    return this.controls.toggleBookmark(controlUserId(req), parsed.data);
  }

  @Post('highlight')
  @UseGuards(JwtAuthGuard)
  async saveHighlight(@Body() body: Record<string, unknown>, @Req() req: ControlReq) {
    const parsed = CreateHighlightInputSchema.safeParse({
      ...body,
      boundingRects: (body as { boundingRectsJson?: unknown }).boundingRectsJson ?? body['boundingRects'],
    });
    if (!parsed.success) throw new BadRequestException('Invalid highlight input');
    return this.controls.saveHighlight(controlUserId(req), parsed.data);
  }

  @Delete('highlight/:highlightId')
  @UseGuards(JwtAuthGuard)
  async deleteHighlight(@Param('highlightId') highlightId: string, @Req() req: ControlReq) {
    if (!highlightId) throw new BadRequestException('Missing highlight id');
    return { success: await this.controls.deleteHighlight(controlUserId(req), highlightId) };
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  async preferences(@Req() req: ControlReq) {
    return this.controls.getPreferences(controlUserId(req));
  }

  @Put('preferences')
  @UseGuards(JwtAuthGuard)
  async updatePreferences(@Body() body: Record<string, unknown>, @Req() req: ControlReq) {
    const parsed = ReaderPreferenceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid preference input');
    return this.controls.updatePreferences(controlUserId(req), parsed.data);
  }
}
