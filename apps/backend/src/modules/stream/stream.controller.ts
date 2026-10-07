// SSOT Phase 044 Task 2/6 — StreamTranscodeController (job gateway + key DRM)
// Canonical: apps/backend/src/modules/stream/stream.controller.ts
// (legacy src/backend/modules/stream/stream.controller.ts)
// - POST /api/v1/stream/transcode {lessonId,fileName,fileSizeBytes,rawR2Key}
//   (JWT creator path, Zod SubmitTranscodeJobSchema) → {jobId}.
// - GET  /api/v1/stream/transcode/:jobId (JWT) → ledger status + progress.
// - GET  /api/v1/stream/key?jobId= (JWT + entitlement, §8.1) → raw key
//   bytes, no-store, never logged.
// - Class is named StreamTranscodeController: the Phase 043 delivery
//   controller already owns the StreamController name (single ownership).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { SubmitTranscodeJobSchema } from '@repo/shared';
import { TranscodeWorkerHost } from './transcoder.worker';
import { StreamService } from './services/stream.service';
import { TranscodeJobReaderService } from './services/transcode-job-reader.service';

interface TranscodeReq {
  user?: { id?: string };
}

interface KeyReply {
  status: (code: number) => KeyReply;
  header: (key: string, value: string) => KeyReply;
  send: (body: unknown) => unknown;
}

@Controller('api/v1/stream/transcode')
export class StreamTranscodeController {
  constructor(
    private readonly worker: TranscodeWorkerHost,
    private readonly stream: StreamService,
    private readonly jobs: TranscodeJobReaderService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async submit(@Body() body: Record<string, unknown>) {
    const parsed = SubmitTranscodeJobSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid transcode request');
    const rawR2Key = body['rawR2Key'];
    if (typeof rawR2Key !== 'string' || !rawR2Key) throw new BadRequestException('Missing raw R2 key');
    return this.worker.submitLessonJob({ ...parsed.data, rawR2Key });
  }

  @Get(':jobId')
  @UseGuards(JwtAuthGuard)
  async status(@Param('jobId') jobId: string) {
    if (!jobId) throw new BadRequestException('Missing job id');
    const row = await this.jobs?.findJobWithVariants(jobId).catch(() => null);
    if (!row) throw new BadRequestException('Transcode job not found');
    return row;
  }
}

@Controller('api/v1/stream/key')
export class TranscodeKeyController {
  constructor(private readonly stream: StreamService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async keyByJob(@Query('jobId') jobId: string | undefined, @Req() req: TranscodeReq, @Res() res: KeyReply) {
    if (!jobId) throw new BadRequestException('Missing job id');
    if (!req.user?.id) throw new BadRequestException('Missing session identity');
    const key = await this.stream.getKeyByTranscodeJob(req.user.id, jobId);
    return res.status(200).header('Content-Type', 'application/octet-stream').header('Cache-Control', 'no-store').send(key);
  }
}
