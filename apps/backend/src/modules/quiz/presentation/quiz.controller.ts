// SSOT Phase 047 — QuizController (LIFF REST transport parity)
// Canonical: apps/backend/src/modules/quiz/presentation/quiz.controller.ts
// - GET  /api/v1/quiz/checkpoints?lessonId= (JWT, sanitized — Gate 4)
// - POST /api/v1/quiz/submit (JWT, zero-trust grading + unlock token)
// - Same services as GQL (no HTTP hop between transports).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { sanitizeCheckpoint } from '@repo/shared';
import { QuizEvaluatorService } from '../application/services/quiz-evaluator.service';
import { PrismaQuizRepository } from '../infrastructure/persistence/prisma-quiz.repository';
import { resolveReaderIdentity } from '../../reader/reader-identity';

interface QuizReq {
  user?: { id?: string; tenantId?: string };
}

@Controller('api/v1/quiz')
export class QuizController {
  constructor(
    private readonly evaluator: QuizEvaluatorService,
    private readonly store: PrismaQuizRepository,
  ) {}

  @Get('checkpoints')
  @UseGuards(JwtAuthGuard)
  async checkpoints(@Query('lessonId') lessonId: string | undefined) {
    if (!lessonId) throw new BadRequestException('Missing lesson id');
    const rows = await this.store.listLessonQuizzes(lessonId);
    return rows.map((row) =>
      sanitizeCheckpoint({
        id: row.id,
        lessonId: row.lessonId,
        timestampSec: row.timestampSec,
        question: row.question,
        quizType: row.quizType,
        options: row.options.map((o) => ({ id: o.id, optionText: o.optionText, optionOrder: o.optionOrder, isCorrect: o.isCorrect })),
      }),
    );
  }

  @Post('submit')
  @UseGuards(JwtAuthGuard)
  async submit(@Body() body: Record<string, unknown>, @Req() req: QuizReq) {
    const { userId } = resolveReaderIdentity({ req });
    return this.evaluator.evaluateSubmission(userId, body);
  }
}
