// SSOT Phase 047 Task 3 — QuizResolver (code-first, §3.2)
// Canonical: apps/backend/src/modules/quiz/presentation/quiz.resolver.ts
// (legacy src/backend/modules/quiz/presentation/quiz.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/quiz.graphql/schema.graphql.
// - Query.getLessonInVideoQuizzes: sanitized checkpoints (Gate 4: never
//   isCorrect/answerKey — enforced by sanitizeCheckpoint at the boundary).
// - Mutation.submitInVideoQuizAnswer: zero-trust grading + unlock token.
// - Zero new deps.
import { Args, Context, Field, Float, ID, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { SubmitQuizAnswerInputSchema, sanitizeCheckpoint } from '@repo/shared';
import { QuizEvaluatorService } from '../application/services/quiz-evaluator.service';
import { PrismaQuizRepository } from '../infrastructure/persistence/prisma-quiz.repository';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../reader/reader-identity';

@ObjectType('QuizOptionPayload')
class QuizOptionPayloadGql {
  @Field(() => ID) id!: string;
  @Field() optionText!: string;
  @Field(() => Int) optionOrder!: number;
}

@ObjectType('InVideoQuizCheckpoint')
class InVideoQuizCheckpointGql {
  @Field(() => ID) id!: string;
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) timestampSec!: number;
  @Field() question!: string;
  @Field() quizType!: string;
  @Field(() => [QuizOptionPayloadGql]) options!: QuizOptionPayloadGql[];
  @Field({ nullable: true }) explanationHint?: string | null;
}

@ObjectType('QuizEvaluationResult')
class QuizEvaluationResultGql {
  @Field() success!: boolean;
  @Field() isCorrect!: boolean;
  @Field(() => Float) earnedScore!: number;
  @Field({ nullable: true }) explanation?: string | null;
  @Field({ nullable: true }) aiHint?: string | null;
  @Field({ nullable: true }) nextSegmentToken?: string | null;
}

@InputType('SubmitQuizAnswerInput')
class SubmitQuizAnswerInputGql {
  @Field(() => ID) quizId!: string;
  @Field(() => ID) lessonId!: string;
  @Field(() => [ID]) selectedOptionIds!: string[];
  @Field({ nullable: true }) shortAnswerText?: string | null;
  @Field(() => Float) playbackTimeSec!: number;
}

@Resolver('Quiz')
export class QuizResolver {
  constructor(
    private readonly evaluator: QuizEvaluatorService,
    private readonly store: PrismaQuizRepository,
  ) {}

  @Query('getLessonInVideoQuizzes')
  @UseGuards(JwtAuthGuard)
  async getLessonInVideoQuizzes(@Args('lessonId') lessonId: string) {
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

  @Mutation('submitInVideoQuizAnswer')
  @UseGuards(JwtAuthGuard)
  async submitInVideoQuizAnswer(@Args('input') input: SubmitQuizAnswerInputGql, @Context() gqlCtx?: ReaderGqlContext) {
    const parsed = SubmitQuizAnswerInputSchema.safeParse({ ...input, shortAnswerText: input.shortAnswerText ?? undefined });
    if (!parsed.success) throw new BadRequestException('Invalid quiz submission');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.evaluator.evaluateSubmission(userId, parsed.data);
  }
}
