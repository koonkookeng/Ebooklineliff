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
import { NetworkQualityTierEnum, ReaderProgressPayloadSchema } from '@repo/shared';
import { ReaderService } from './reader.service';
import { LowBandwidthReaderService } from './services/low-bandwidth-reader.service';

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
  constructor(
    private readonly reader: ReaderService,
    private readonly lowband: LowBandwidthReaderService,
  ) {}

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

  // Phase 055 §6.1: Brotli-compressed chunk for low-bandwidth LIFF clients.
  @Get('chunk-compressed')
  @UseGuards(JwtAuthGuard)
  async getCompressedChunk(
    @Query('productId') productId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('network') network: string | undefined,
    @Query('format') format: string | undefined,
    @Query('tenantId') queryTenantId: string | undefined,
    @Req() req: ReaderReq,
  ) {
    const pageNumber = Number(page);
    const tier = NetworkQualityTierEnum.safeParse(network);
    const fmt = format === undefined ? 'BROTLI' : format;
    if (!productId || !Number.isInteger(pageNumber) || pageNumber <= 0 || !tier.success) {
      throw new BadRequestException('Invalid compressed chunk request');
    }
    if (fmt !== 'BROTLI' && fmt !== 'GZIP' && fmt !== 'RAW_SVG') {
      throw new BadRequestException('Invalid compress format');
    }
    const { userId, tenantId } = reqIdentity(req, queryTenantId);
    return this.lowband.getCompressedVectorChunk(productId, pageNumber, tier.data, userId, tenantId, fmt);
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
