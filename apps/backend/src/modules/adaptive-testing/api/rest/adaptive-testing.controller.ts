// SSOT Phase 093 — Adaptive testing REST (JWT userId only)
// Canonical: apps/backend/src/modules/adaptive-testing/api/rest/adaptive-testing.controller.ts
// - GET next (start/resume) / POST submit. Server trusts JWT userId, never
//   client userId (Gate 4). Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { AdaptiveAttemptService } from '../../application/services/adaptive-attempt.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/adaptive')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AdaptiveTestingController {
  constructor(private readonly attempts: AdaptiveAttemptService) {}

  @Get('next')
  next(@Req() req: LooseReq, @Query('lessonId') lessonId: string | undefined) {
    if (!lessonId) throw new BadRequestException('Missing lessonId');
    return this.attempts.start({ userId: actorOf(req), lessonId });
  }

  @Post('submit')
  submit(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as {
      lessonId?: string; questionId?: string; selectedOptionId?: string; responseTimeMs?: number;
    };
    return this.attempts.submit({
      userId: actorOf(req),
      lessonId: b.lessonId ?? '',
      questionId: b.questionId ?? '',
      selectedOptionId: b.selectedOptionId ?? '',
      responseTimeMs: b.responseTimeMs ?? 0,
    });
  }
}
