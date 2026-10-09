// SSOT Phase 092 Task 6 — Adaptive quiz REST (server-side grading via Redis key)
// Canonical: apps/backend/src/modules/ai-companion/controllers/ai-quiz.controller.ts
// - POST generate (lesson chunks → quiz WITHOUT answers, key parked in
//   Redis 1h) / POST submit (graded server-side — Phase 047 sanitizer
//   precedent). Zero new deps.
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { AdaptiveQuizService } from '../services/adaptive-quiz.service';

export interface QuizAnswerStore {
  saveAnswers(quizId: string, correctIndexes: number[], ttlSec: number): Promise<void>;
  takeAnswers(quizId: string): Promise<number[] | null>;
}

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/ai/quiz')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AiQuizController {
  constructor(
    private readonly quiz: AdaptiveQuizService,
    private readonly answers: QuizAnswerStore,
  ) {}

  @Post('generate')
  async generate(@Req() req: LooseReq, @Body() body: unknown) {
    const userId = actorOf(req);
    const b = (body ?? {}) as { lessonId?: string; chunks?: string[]; weakTopic?: string };
    if (!b.lessonId || !Array.isArray(b.chunks)) throw new BadRequestException('Missing lessonId/chunks');
    const r = await this.quiz.generate({ userId, lessonId: b.lessonId, chunks: b.chunks });
    await this.answers.saveAnswers(
      r.quizId,
      r.questions.map((q) => q.correctIndex),
      3600,
    );
    return {
      quizId: r.quizId,
      lessonId: r.lessonId,
      level: r.level,
      questions: r.questions.map((q) => ({
        questionId: q.questionId,
        prompt: q.prompt,
        options: q.options,
        explanation: q.explanation,
      })),
    };
  }

  @Post('submit')
  async submit(@Req() req: LooseReq, @Body() body: unknown) {
    const userId = actorOf(req);
    const b = (body ?? {}) as { quizId?: string; lessonId?: string; answers?: number[]; weakTopic?: string };
    if (!b.quizId || !b.lessonId || !Array.isArray(b.answers)) {
      throw new BadRequestException('Missing quizId/lessonId/answers');
    }
    const correctIndexes = await this.answers.takeAnswers(b.quizId);
    if (!correctIndexes) throw new BadRequestException('Quiz expired or already submitted');
    return this.quiz.submit({
      userId,
      lessonId: b.lessonId,
      answers: b.answers,
      correctIndexes,
      weakTopic: b.weakTopic ?? '',
    });
  }
}
