// SSOT Phase 093 Task 2 — Adaptive testing GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/adaptive-testing/api/graphql/adaptive-testing.resolver.ts
// - Query.adaptiveNextQuestion (start/resume) / Mutation.submitAdaptiveAnswer.
//   Server trusts JWT userId, never client userId (Gate 4).
// - Zero new deps.
import { Args, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { AdaptiveAttemptService } from '../../application/services/adaptive-attempt.service';
import { AdaptiveNextQuestionGql, AdaptiveSubmitAnswerInputGql } from './adaptive-testing.type';

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function shapeOf(r: {
  questionId: string; questionText: string; options: Array<{ id: string; text: string }>;
  currentTheta: number; estimatedMasteryPercent: number; isTestCompleted: boolean;
}): AdaptiveNextQuestionGql {
  const out = new AdaptiveNextQuestionGql();
  out.questionId = r.questionId;
  out.questionText = r.questionText;
  out.options = r.options;
  out.currentTheta = r.currentTheta;
  out.estimatedMasteryPercent = r.estimatedMasteryPercent;
  out.isTestCompleted = r.isTestCompleted;
  return out;
}

@Resolver('AdaptiveTesting')
export class AdaptiveTestingResolver {
  constructor(private readonly attempts: AdaptiveAttemptService) {}

  @Query('adaptiveNextQuestion')
  async adaptiveNextQuestion(@Args('lessonId') lessonId: string, @Context() ctx: LooseCtx) {
    return shapeOf(await this.attempts.start({ userId: actorOf(ctx), lessonId }));
  }

  @Mutation('submitAdaptiveAnswer')
  async submitAdaptiveAnswer(@Args('input') input: AdaptiveSubmitAnswerInputGql, @Context() ctx: LooseCtx) {
    const userId = actorOf(ctx);
    return shapeOf(
      await this.attempts.submit({
        userId,
        lessonId: input.lessonId,
        questionId: input.questionId,
        selectedOptionId: input.selectedOptionId,
        responseTimeMs: input.responseTimeMs,
      }),
    );
  }
}
