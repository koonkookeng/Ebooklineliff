// SSOT Phase 050 §5.3 — HLS playlist / segment / key delivery (token-gated, zero egress)
// Canonical: apps/backend/src/modules/stream/controllers/hls-stream.controller.ts
// (legacy src/backend/modules/stream/controllers/hls-stream.controller.ts)
// - Segments + key ride short-lived HMAC query tokens (native <video> cannot
//   attach Authorization headers); session bootstrap POST stays JWT-gated.
// - VideoRateLimitGuard throttles .ts/.m4s pulls (429 < 3ms via Redis pipeline).
// - Structural Req/Reply types (no fastify import) per Phase 043 precedent.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { HlsStreamTokenRequestSchema, VIDEO_SEGMENT_TOKEN_TTL_SEC } from '@repo/shared';
import { VideoRateLimitGuard } from '../guards/video-rate-limit.guard';
import { HlsSecurityService } from '../services/hls-security.service';
import { VideoSessionService } from '../services/video-session.service';

interface HlsReq {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

interface HlsReply {
  header: (key: string, value: string) => HlsReply;
  type: (mime: string) => HlsReply;
  send: (body: unknown) => unknown;
}

function ipOf(req: HlsReq): string {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

@Controller('api/v1/hls')
export class HlsStreamController {
  constructor(
    private readonly security: HlsSecurityService,
    private readonly sessions: VideoSessionService,
  ) {}

  /** Bootstrap: JWT identity → playback session + manifest token (player renews every 8s). */
  @Post(':lessonId/session')
  @UseGuards(JwtAuthGuard)
  async createSession(
    @Param('lessonId') lessonId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: HlsReq,
  ) {
    const parsed = HlsStreamTokenRequestSchema.safeParse({
      ...(body ?? {}),
      lessonId,
      userId: req.user?.id ?? body?.['userId'],
      ipAddress: ipOf(req),
    });
    if (!parsed.success) throw new BadRequestException('Invalid stream session request');
    const session = await this.sessions.createPlaybackSession(parsed.data);
    const manifestToken = this.security.signToken(lessonId, 'MANIFEST_ACCESS');
    return {
      playbackSessionId: session.playbackSessionId,
      streamToken: manifestToken,
      expiresAt: Date.now() + VIDEO_SEGMENT_TOKEN_TTL_SEC * 1000,
      keyRotationIntervalSec: 10,
    };
  }

  @Get(':lessonId/playlist.m3u8')
  async getEncryptedPlaylist(
    @Param('lessonId') lessonId: string,
    @Query('token') token: string | undefined,
    @Res() res: HlsReply,
  ) {
    if (!token) throw new BadRequestException('Missing playlist token');
    const playlist = await this.security.generateDynamicM3u8Playlist(lessonId, token);
    return res.type('application/x-mpegURL').header('Cache-Control', 'no-store').send(playlist);
  }

  @Get(':lessonId/segments/:segmentName')
  @UseGuards(VideoRateLimitGuard)
  async getSegment(
    @Param('lessonId') lessonId: string,
    @Param('segmentName') segmentName: string,
    @Query('token') token: string | undefined,
    @Res() res: HlsReply,
  ) {
    if (!token) throw new BadRequestException('Missing segment token');
    await this.security.verifySegmentToken(token, lessonId, segmentName);
    const buffer = await this.security.fetchR2SegmentStream(lessonId, segmentName);
    const mime = segmentName.endsWith('.m4s') ? 'video/iso-segment' : 'video/MP2T';
    return res.type(mime).header('Cache-Control', 'no-store').send(buffer);
  }

  @Get(':lessonId/key')
  @UseGuards(VideoRateLimitGuard)
  async getDecryptionKey(
    @Param('lessonId') lessonId: string,
    @Query('token') token: string | undefined,
    @Res() res: HlsReply,
  ) {
    if (!token) throw new BadRequestException('Missing key token');
    const key = await this.security.getRotatedKey(lessonId, token);
    return res.type('application/octet-stream').header('Cache-Control', 'no-store').send(key);
  }
}
