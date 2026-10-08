// SSOT Phase 051 §5.1/§8.1 — video preview REST (public; 120s window, 60s tokens)
// Canonical: apps/backend/src/modules/preview/controllers/video-preview.controller.ts
// (legacy src/backend/modules/stream/preview-stream.controller.ts —
//  consolidated here per the §5.1 preview module tree; no logic fork.)
// - GET stream ⇒ trimmed playlist URL + token + maxSec (player builds from it).
// - GET playlist/segments/key verify per-segment 60s tokens; segment fetches
//   additionally validate the preview window via token binding (§8.1).
import { BadRequestException, Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { PREVIEW_VIDEO_DEFAULT_SEC } from '@repo/shared';
import { R2StorageService } from '../../../infra/cloudflare/r2-storage.service';
import { previewIdentityOf, type PreviewHttpReq } from '../preview-identity';
import { PreviewGatekeeperService } from '../services/preview-gatekeeper.service';
import { PreviewHlsTokenService } from '../services/hls-token.service';

interface PreviewVideoReply {
  header: (key: string, value: string) => PreviewVideoReply;
  type: (mime: string) => PreviewVideoReply;
  send: (body: unknown) => unknown;
}

@Controller('api/v1/preview/video')
export class VideoPreviewController {
  constructor(
    private readonly gate: PreviewGatekeeperService,
    private readonly tokens: PreviewHlsTokenService,
    private readonly r2: R2StorageService,
  ) {}

  @Get('stream')
  async stream(@Query('lessonId') lessonId: string | undefined, @Req() req: PreviewHttpReq) {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    const verdict = await this.gate.validateVideoPreviewAccess(previewIdentityOf(req), lessonId);
    if (!verdict.isPreviewMode) {
      return { hasEntitlement: true, maxAllowedSeconds: verdict.maxAllowedSec };
    }
    return {
      lessonId,
      hlsPreviewPlaylistUrl: `/api/v1/preview/video/playlist?lessonId=${lessonId}`,
      maxAllowedSeconds: verdict.maxAllowedSec || PREVIEW_VIDEO_DEFAULT_SEC,
      previewToken: this.tokens.mintSegmentToken(lessonId, 'playlist'),
      hasEntitlement: false,
    };
  }

  @Get('playlist')
  async playlist(
    @Query('lessonId') lessonId: string | undefined,
    @Query('token') token: string | undefined,
    @Req() req: PreviewHttpReq,
    @Res() res: PreviewVideoReply,
  ) {
    if (!lessonId || !token) throw new BadRequestException('Missing preview playlist request');
    this.tokens.verifySegmentToken(token, lessonId, 'playlist');
    const verdict = await this.gate.validateVideoPreviewAccess(previewIdentityOf(req), lessonId);
    const master = await this.r2.getObjectText(`hls/${lessonId}/master.m3u8`);
    const body = this.tokens.buildPreviewPlaylist(lessonId, verdict.maxAllowedSec, master);
    return res.type('application/x-mpegURL').header('Cache-Control', 'no-store').send(body);
  }

  @Get('segments/:segmentName')
  async segment(
    @Param('segmentName') segmentName: string,
    @Query('lessonId') lessonId: string | undefined,
    @Query('token') token: string | undefined,
    @Res() res: PreviewVideoReply,
  ) {
    if (!lessonId || !token) throw new BadRequestException('Missing preview segment request');
    if (!/^[A-Za-z0-9_\-]+\.(ts|m4s)$/.test(segmentName)) {
      throw new BadRequestException('Invalid segment name');
    }
    this.tokens.verifySegmentToken(token, lessonId, segmentName);
    const buffer = await this.r2.getObjectBuffer(`hls/${lessonId}/segments/${segmentName}`);
    const mime = segmentName.endsWith('.m4s') ? 'video/iso-segment' : 'video/MP2T';
    return res.type(mime).header('Cache-Control', 'no-store').send(buffer);
  }

  @Get('key')
  async key(
    @Query('lessonId') lessonId: string | undefined,
    @Query('token') token: string | undefined,
    @Res() res: PreviewVideoReply,
  ) {
    if (!lessonId || !token) throw new BadRequestException('Missing preview key request');
    this.tokens.verifySegmentToken(token, lessonId, 'key');
    return res.type('application/octet-stream').header('Cache-Control', 'no-store').send(this.tokens.derivePreviewKey(lessonId));
  }
}
