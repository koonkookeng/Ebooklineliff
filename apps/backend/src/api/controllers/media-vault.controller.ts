// SSOT Phase 036 Task 6 — Media vault controller (entitlement-gated R2 delivery)
// Canonical: apps/backend/src/api/controllers/media-vault.controller.ts
// (legacy src/backend/api/controllers/media-vault.controller.ts)
// - GET ebook-chunk/:productId/page/:pageNumber — BDD Scenario 1: JWT +
//   EdgeStreamEntitlementGuard (preview 1–10 inside the guard) → Redis edge
//   (<20ms hit) → R2 → 24h edge refill; watermark + zero-egress headers.
// - GET hls-manifest/:lessonId?courseId= — BDD Scenario 2: lesson→course→
//   entitlement join, 60s presigned manifest + HMAC stream bearer token.
// - POST upload-url — §3.2 creator intent: Zod-gated key layout + presigned PUT.
// - Registered via R2StorageModule (transport + delivery in one phase unit).
// - Zero new deps.
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { EdgeStreamEntitlementGuard } from '../../modules/entitlement/guards/edge-stream-entitlement.guard';
import {
  HLS_TOKEN_TTL_SEC,
  R2UploadRequestSchema,
  R2_CHUNK_CACHE_TTL_SEC,
  R2_PREVIEW_MAX_PAGE,
  chunkCacheKey,
  chunkObjectKey,
  hlsObjectPrefix,
} from '@repo/shared';

interface VaultTables {
  ebookDetail: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  ebookChunkMeta: {
    findFirst: (args: unknown) => Promise<{ r2ObjectKey: string } | null>;
  };
  courseLesson: {
    findFirst: (args: unknown) => Promise<{ id: string; section: { courseDetail: { productId: string } } } | null>;
  };
  entitlement: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
}

interface VaultReq {
  user?: { id?: string; lineUserId?: string };
}

interface VaultReply {
  status: (code: number) => VaultReply;
  header: (key: string, value: string) => VaultReply;
  send: (body: unknown) => unknown;
}

function watermarkFor(userId: string): { watermarkText: string; timestamp: string; userIdHash: string } {
  const hash = createHmac('sha256', process.env.WATERMARK_PEPPER ?? 'vault-pepper')
    .update(userId)
    .digest('hex')
    .slice(0, 16);
  return { watermarkText: `USER-${hash.slice(0, 8)}`, timestamp: new Date().toISOString(), userIdHash: hash };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || 'upload.bin';
}

@Controller('api/v1/media-vault')
export class MediaVaultController {
  constructor(
    private readonly r2: R2StorageService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get tables(): VaultTables {
    return this.prisma as unknown as VaultTables;
  }

  @Get('ebook-chunk/:productId/page/:pageNumber')
  @UseGuards(JwtAuthGuard, EdgeStreamEntitlementGuard)
  async streamEbookChunk(
    @Param('productId') productId: string,
    @Param('pageNumber') pageNumber: string,
    @Req() req: VaultReq,
    @Res() res: VaultReply,
  ) {
    const page = Number.parseInt(pageNumber, 10);
    if (!productId || !Number.isInteger(page) || page <= 0) throw new BadRequestException('Invalid chunk request');
    const userId = req.user?.id as string;

    const ebook = await this.tables.ebookDetail.findFirst({ where: { productId } }).catch(() => null);
    if (!ebook) throw new NotFoundException('Ebook not found');
    const meta = await this.tables.ebookChunkMeta
      .findFirst({ where: { ebookId: ebook.id, pageNumber: page } })
      .catch(() => null);
    // Planned key fallback: manifests backfill async; serve the canonical key.
    const objectKey = meta?.r2ObjectKey ?? chunkObjectKey(productId, page);

    const cacheKey = chunkCacheKey(objectKey);
    let vectorSvgContent = await this.redis.get(cacheKey).catch(() => null);
    if (!vectorSvgContent) {
      vectorSvgContent = await this.r2.getObjectText(objectKey).catch(() => null);
      if (!vectorSvgContent) throw new NotFoundException('Requested E-Book page chunk does not exist.');
      await this.redis.setex(cacheKey, R2_CHUNK_CACHE_TTL_SEC, vectorSvgContent).catch(() => undefined);
    }

    const watermarkData = watermarkFor(userId);
    return res
      .status(200)
      .header('Content-Type', 'application/json')
      .header('X-Zero-Egress-Verified', 'true')
      .header('X-Watermark-Signature', watermarkData.userIdHash)
      .send({ pageNumber: page, vectorSvgContent, watermarkData, preview: page <= R2_PREVIEW_MAX_PAGE });
  }

  @Get('hls-manifest/:lessonId')
  @UseGuards(JwtAuthGuard, EdgeStreamEntitlementGuard)
  async hlsManifest(
    @Param('lessonId') lessonId: string,
    @Query('courseId') courseId: string | undefined,
    @Req() req: VaultReq,
  ) {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    const userId = req.user?.id as string;
    const lesson = await this.tables.courseLesson
      .findFirst({ where: { id: lessonId }, include: { section: { include: { courseDetail: true } } } })
      .catch(() => null);
    if (!lesson) throw new NotFoundException('Lesson not found');
    const productId = lesson.section.courseDetail.productId;
    if (courseId && courseId !== productId) throw new BadRequestException('Lesson does not belong to course');
    const grant = await this.tables.entitlement
      .findFirst({ where: { userId, productId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
      .catch(() => null);
    if (!grant) throw new ForbiddenException('Content access denied');

    const manifestKey = `${hlsObjectPrefix(lessonId)}master.m3u8`;
    const expiresAt = new Date(Date.now() + HLS_TOKEN_TTL_SEC * 1000);
    const streamToken = createHmac('sha256', process.env.HLS_TOKEN_PEPPER ?? 'hls-pepper')
      .update(`${lessonId}.${Math.floor(expiresAt.getTime() / 1000)}.${userId}`)
      .digest('hex');
    return {
      playlistUrl: this.r2.presignedGetUrl(manifestKey, HLS_TOKEN_TTL_SEC, 'application/x-mpegURL'),
      streamToken,
      expiresAt: expiresAt.toISOString(),
      zeroEgressVerified: true,
    };
  }

  @Post('upload-url')
  @UseGuards(JwtAuthGuard)
  uploadUrl(@Body() body: unknown) {
    const parsed = R2UploadRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload request');
    const input = parsed.data;
    const dir =
      input.mediaType === 'EBOOK_VECTOR_CHUNK'
        ? `vault/ebooks/${input.productId}/chunks`
        : input.mediaType === 'HLS_PLAYLIST' || input.mediaType === 'HLS_SEGMENT'
          ? `vault/hls/${input.productId}`
          : `vault/assets/${input.productId}`;
    const objectKey = `${dir}/${sanitizeFileName(input.fileName)}`;
    return {
      uploadUrl: this.r2.presignedPutUrl(objectKey, input.mimeType, 3600),
      objectKey,
      headersRequired: 'Content-Type',
    };
  }
}
