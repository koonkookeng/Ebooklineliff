// SSOT Phase 040 Task 40.2 — ReaderController (entitled chunk + progress REST)
// Canonical: apps/backend/src/modules/reader/reader.controller.ts
// (legacy src/backend/modules/reader/reader.controller.ts)
// - GET /api/v1/reader/chunk?productId=&page=(&tenantId=) — JWT-guarded;
//   tenant resolves from the token (query only as fallback), so clients can
//   never spoof another tenant's key space. Returns EbookChunkPayload.
// - POST /api/v1/reader/progress {productId,lastPage,readDurationSec} —
//   Zod-gated boundary (timestamp server-stamped), single-upsert <50ms.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { ReaderProgressPayloadSchema } from '@repo/shared';
import { ReaderService } from './reader.service';

interface ReaderReq {
  user?: { id?: string; tenantId?: string };
}

function reqIdentity(req: ReaderReq, queryTenantId?: string): { userId: string; tenantId: string } {
  const userId = req.user?.id;
  if (!userId) throw new BadRequestException('Missing session identity');
  return { userId, tenantId: req.user?.tenantId ?? queryTenantId ?? 'default' };
}

@Controller('api/v1/reader')
export class ReaderController {
  constructor(private readonly reader: ReaderService) {}

  @Get('chunk')
  @UseGuards(JwtAuthGuard)
  async getChunk(
    @Query('productId') productId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('tenantId') queryTenantId: string | undefined,
    @Req() req: ReaderReq,
  ) {
    const pageNumber = Number(page);
    if (!productId || !Number.isInteger(pageNumber) || pageNumber <= 0) {
      throw new BadRequestException('Invalid chunk request');
    }
    const { userId, tenantId } = reqIdentity(req, queryTenantId);
    return this.reader.getEbookPageChunk(userId, tenantId, productId, pageNumber);
  }

  @Post('progress')
  @UseGuards(JwtAuthGuard)
  async syncProgress(@Body() body: Record<string, unknown>, @Req() req: ReaderReq) {
    const parsed = ReaderProgressPayloadSchema.safeParse({
      productId: body['productId'],
      lastPage: body['lastPage'],
      readDurationSec: body['readDurationSec'] ?? 0,
      timestamp:
        typeof body['timestamp'] === 'string' ? body['timestamp'] : new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid progress payload');
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.reader.syncEbookProgress(userId, parsed.data.productId, parsed.data.lastPage, parsed.data.readDurationSec);
  }
}
