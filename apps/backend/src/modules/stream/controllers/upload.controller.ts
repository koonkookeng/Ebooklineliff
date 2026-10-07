// SSOT Phase 043 Task 3 — UploadController (presigned parts + lifecycle REST)
// Canonical: apps/backend/src/modules/stream/controllers/upload.controller.ts
// - POST /api/v1/stream/upload/initiate (JWT, Zod InitiateUploadSchema)
// - GET  /api/v1/stream/upload/:videoId/status (JWT)
// - POST /api/v1/stream/upload/complete {videoId} (JWT, creator path)
// - POST /api/v1/stream/webhook/video-uploaded (worker secret, §5.2)
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { InitiateUploadSchema, VideoWorkerEventSchema } from '@repo/shared';
import { VideoUploadService } from '../services/video-upload.service';

@Controller('api/v1/stream/upload')
export class UploadController {
  constructor(private readonly uploads: VideoUploadService) {}

  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  async initiate(@Body() body: Record<string, unknown>) {
    const parsed = InitiateUploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload request');
    return this.uploads.initiateUpload(parsed.data);
  }

  @Get(':videoId/status')
  @UseGuards(JwtAuthGuard)
  async status(@Param('videoId') videoId: string) {
    if (!videoId) throw new BadRequestException('Missing video id');
    return this.uploads.getUploadStatus(videoId);
  }

  @Post('complete')
  @UseGuards(JwtAuthGuard)
  async complete(@Body() body: Record<string, unknown>) {
    const videoId = body['videoId'];
    if (typeof videoId !== 'string' || !videoId) throw new BadRequestException('Missing video id');
    return this.uploads.completeUpload(videoId);
  }

  @Post('webhook/video-uploaded')
  async workerWebhook(@Body() body: Record<string, unknown>, @Headers('x-worker-secret') secret: string | undefined) {
    const parsed = VideoWorkerEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid worker event');
    return this.uploads.handleWorkerEvent(parsed.data, secret ?? '');
  }
}
