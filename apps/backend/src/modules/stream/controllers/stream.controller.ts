// SSOT Phase 043 Task 5 + Phase 045 §5.2 — StreamController (delivery REST)
// Canonical: apps/backend/src/modules/stream/controllers/stream.controller.ts
// - GET  /api/v1/stream/manifest?lessonId= (JWT, entitlement-gated)
// - GET  /api/v1/stream/key?videoId=&token= (JWT + short-lived token; key
//   bytes served with no-store, never logged)
// - POST /api/v1/stream/progress {lessonId,watchedSec} (JWT, 5s cadence)
// - GET  /api/v1/stream/lesson-state?lessonId= (JWT, Phase 045: manifest +
//   resume + watermark in one call)
// - POST /api/v1/stream/lesson-progress {lessonId,watchedSec,durationSec,
//   isCompleted} (JWT, Phase 045: DB upsert + heatmap event)
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { SyncLessonProgressSchema, VideoProgressReportSchema } from '@repo/shared';
import { StreamService } from '../services/stream.service';

interface StreamReq {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

interface StreamReply {
  status: (code: number) => StreamReply;
  header: (key: string, value: string) => StreamReply;
  send: (body: unknown) => unknown;
}

function identityOf(req: StreamReq): string {
  if (!req.user?.id) throw new BadRequestException('Missing session identity');
  return req.user.id;
}

function ipOf(req: StreamReq): string {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

@Controller('api/v1/stream')
export class StreamController {
  constructor(private readonly stream: StreamService) {}

  @Get('manifest')
  @UseGuards(JwtAuthGuard)
  async manifest(@Query('lessonId') lessonId: string | undefined, @Req() req: StreamReq) {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    return this.stream.getManifest(identityOf(req), lessonId, ipOf(req));
  }

  @Get('key')
  @UseGuards(JwtAuthGuard)
  async segmentKey(
    @Query('videoId') videoId: string | undefined,
    @Query('token') token: string | undefined,
    @Req() req: StreamReq,
    @Res() res: StreamReply,
  ) {
    if (!videoId || !token) throw new BadRequestException('Missing key request');
    const key = await this.stream.getSegmentKey(identityOf(req), videoId, token);
    return res.status(200).header('Content-Type', 'application/octet-stream').header('Cache-Control', 'no-store').send(key);
  }

  @Post('progress')
  @UseGuards(JwtAuthGuard)
  async progress(@Body() body: Record<string, unknown>, @Req() req: StreamReq) {
    const parsed = VideoProgressReportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid progress report');
    return this.stream.reportProgress(identityOf(req), parsed.data.lessonId, parsed.data.watchedSec);
  }

  @Get('lesson-state')
  @UseGuards(JwtAuthGuard)
  async lessonState(@Query('lessonId') lessonId: string | undefined, @Req() req: StreamReq) {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    return this.stream.getLessonStreamState(identityOf(req), lessonId, ipOf(req));
  }

  @Post('lesson-progress')
  @UseGuards(JwtAuthGuard)
  async lessonProgress(@Body() body: Record<string, unknown>, @Req() req: StreamReq) {
    const parsed = SyncLessonProgressSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid lesson progress');
    return this.stream.syncLessonProgress(identityOf(req), parsed.data);
  }
}
