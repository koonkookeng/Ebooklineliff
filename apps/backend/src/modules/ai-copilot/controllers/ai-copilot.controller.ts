// SSOT Phase 094 Task 2 — Co-Pilot REST (creator JWT + SSE outline stream)
// Canonical: apps/backend/src/modules/ai-copilot/controllers/ai-copilot.controller.ts
// - POST outline / SSE outline-stream / POST transcribe / GET job /
//   POST quiz-from-transcript. Zero new deps (rxjs ships with Nest).
import { BadRequestException, Body, Controller, Get, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { OutlineGeneratorService } from '../services/outline-generator.service';
import { WhisperTranscriberService } from '../services/whisper-transcriber.service';
import { AutoQuizBuilderService } from '../services/auto-quiz-builder.service';

export interface JobStatusStore {
  findJob(jobId: string, userId: string): Promise<{ id: string; status: string; progressPercent: number; errorMessage: string | null } | null>;
}

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/copilot')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AiCopilotController {
  constructor(
    private readonly outline: OutlineGeneratorService,
    private readonly transcriber: WhisperTranscriberService,
    private readonly quiz: AutoQuizBuilderService,
    private readonly jobs: JobStatusStore,
  ) {}

  @Post('outline')
  generateOutline(@Req() req: LooseReq, @Body() body: unknown) {
    return this.outline.generate({ userId: actorOf(req), prompt: (body ?? {}) as never });
  }

  @Sse('outline-stream')
  outlineStream(@Req() req: LooseReq, @Query('topic') topic: string): Observable<{ data: string }> {
    return new Observable<{ data: string }>((subscriber) => {
      void (async () => {
        try {
          const userId = actorOf(req);
          const r = await this.outline.generate({
            userId,
            prompt: { topic: topic ?? '', targetAudience: 'ทั่วไป', difficultyLevel: 'BEGINNER', numberOfSections: 3 },
          });
          subscriber.next({ data: JSON.stringify({ type: 'start', jobId: r.jobId }) });
          for (const section of r.sections) {
            subscriber.next({ data: JSON.stringify({ type: 'token', section }) });
          }
          subscriber.next({ data: JSON.stringify({ type: 'done', jobId: r.jobId }) });
          subscriber.complete();
        } catch (e) {
          subscriber.next({ data: JSON.stringify({ type: 'error', message: (e as Error).message }) });
          subscriber.complete();
        }
      })();
    });
  }

  @Post('transcribe')
  transcribe(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { lessonId?: string; transcriptText?: string; durationSec?: number; language?: string };
    return this.transcriber.requestTranscribe({
      userId: actorOf(req),
      lessonId: b.lessonId ?? '',
      transcriptText: b.transcriptText ?? '',
      durationSec: b.durationSec ?? 0,
      language: b.language,
    });
  }

  @Get('job')
  async job(@Req() req: LooseReq, @Query('jobId') jobId: string | undefined) {
    if (!jobId) throw new BadRequestException('Missing jobId');
    const row = await this.jobs.findJob(jobId, actorOf(req));
    if (!row) throw new BadRequestException('Job not found');
    return row;
  }

  @Post('quiz-from-transcript')
  quizFromTranscript(@Body() body: unknown) {
    const b = (body ?? {}) as { lessonId?: string; transcriptText?: string };
    return this.quiz.buildFromTranscript({ lessonId: b.lessonId ?? '', transcriptText: b.transcriptText ?? '' });
  }
}
