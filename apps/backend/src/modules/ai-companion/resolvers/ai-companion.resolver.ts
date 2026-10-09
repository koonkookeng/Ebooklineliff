// SSOT Phase 092 — AI companion GraphQL intents (code-first, single file)
// Canonical: apps/backend/src/modules/ai-companion/resolvers/ai-companion.resolver.ts
// - RISK_CALL: GQL types inline (filefolder canonical keeps 092 tree without
//   api/ — single-file code-first). Mutations: askAiCompanion /
//   summarizeContent / generateAdaptiveQuiz / submitAdaptiveQuiz.
//   Query: aiChatHistory.
// - Zero new deps.
import { Args, Field, ID, InputType, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CompanionSummarizerService } from '../services/summarizer.service';
import { AdaptiveQuizService } from '../services/adaptive-quiz.service';
import { EntitlementGrantService } from '../../entitlement/services/entitlement-grant.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { QuizAnswerStore } from '../controllers/ai-quiz.controller';

@ObjectType('AiCitation')
class AiCitationGql {
  @Field(() => Int, { nullable: true })
  pageNumber?: number;

  @Field(() => Int, { nullable: true })
  timestampSec?: number;

  @Field()
  snippetText!: string;
}

@ObjectType('AiChatResponse')
class AiChatResponseGql {
  @Field(() => ID)
  sessionId!: string;

  @Field(() => ID)
  messageId!: string;

  @Field()
  answerMarkdown!: string;

  @Field(() => [AiCitationGql])
  citations!: AiCitationGql[];

  @Field(() => Int)
  tokenUsed!: number;
}

@ObjectType('AiChatMessageItem')
class AiChatMessageItemGql {
  @Field(() => ID)
  messageId!: string;

  @Field()
  sender!: string;

  @Field()
  content!: string;

  @Field()
  createdAt!: string;
}

@ObjectType('AdaptiveQuizQuestionPublic')
class AdaptiveQuizQuestionPublicGql {
  @Field()
  questionId!: string;

  @Field()
  prompt!: string;

  @Field(() => [String])
  options!: string[];

  @Field()
  explanation!: string;
}

@ObjectType('AdaptiveQuizPayload')
class AdaptiveQuizPayloadGql {
  @Field(() => ID)
  quizId!: string;

  @Field(() => ID)
  lessonId!: string;

  @Field()
  level!: string;

  @Field(() => [AdaptiveQuizQuestionPublicGql])
  questions!: AdaptiveQuizQuestionPublicGql[];
}

@ObjectType('AdaptiveQuizResult')
class AdaptiveQuizResultGql {
  @Field(() => Int)
  score!: number;

  @Field(() => Int)
  correct!: number;

  @Field(() => Int)
  total!: number;

  @Field()
  nextLevel!: string;
}

@InputType('AiChatQueryInput')
class AiChatQueryInputGql {
  @Field(() => ID, { nullable: true })
  sessionId?: string;

  @Field(() => ID)
  productId!: string;

  @Field()
  userQuestion!: string;

  @Field(() => Int, { nullable: true })
  currentPage?: number;

  @Field(() => Int, { nullable: true })
  currentLessonSec?: number;
}

@InputType('AiSummaryInput')
class AiSummaryInputGql {
  @Field(() => ID)
  productId!: string;

  @Field()
  sourceType!: string;

  @Field(() => Int, { nullable: true })
  targetPage?: number;

  @Field(() => ID, { nullable: true })
  lessonId?: string;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string | null; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  return { userId: user.id ?? null, tenantId };
}

function actorOf(ctx: LooseCtx): { userId: string; tenantId: string } {
  const { userId, tenantId } = ctxOf(ctx);
  if (!userId) throw new BadRequestException('Missing authentication');
  if (!tenantId) throw new BadRequestException('Missing tenant scope');
  return { userId, tenantId };
}

@Resolver('AiCompanion')
export class AiCompanionResolver {
  constructor(
    private readonly companion: CompanionSummarizerService,
    private readonly quiz: AdaptiveQuizService,
    private readonly answers: QuizAnswerStore,
    private readonly grants: EntitlementGrantService,
    private readonly prisma: PrismaService,
  ) {}

  private hashOf(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 12);
  }

  private async gate(userId: string, productId: string): Promise<void> {
    const ok = await this.grants.hasAccess(this.prisma as never, userId, productId);
    if (!ok) throw new ForbiddenException('Entitlement required for this product');
  }

  @Mutation('askAiCompanion')
  async askAiCompanion(@Args('input') input: AiChatQueryInputGql, @Context() ctx: LooseCtx) {
    const { userId, tenantId } = actorOf(ctx);
    await this.gate(userId, input.productId);
    const r = await this.companion.chat({
      userId,
      tenantId,
      userIdHash: this.hashOf(userId),
      query: { ...input },
    });
    const out = new AiChatResponseGql();
    out.sessionId = r.sessionId;
    out.messageId = r.messageId;
    out.answerMarkdown = r.answerMarkdown;
    out.citations = r.citations;
    out.tokenUsed = r.tokenUsed;
    return out;
  }

  @Mutation('summarizeContent')
  summarizeContent(@Args('input') input: AiSummaryInputGql, @Context() ctx: LooseCtx) {
    const { userId, tenantId } = actorOf(ctx);
    return this.gate(userId, input.productId).then(() =>
      this.companion.summarize({
        userId,
        tenantId,
        userIdHash: this.hashOf(userId),
        request: { ...input, sourceType: input.sourceType },
      }),
    );
  }

  @Mutation('generateAdaptiveQuiz')
  async generateAdaptiveQuiz(
    @Args('lessonId') lessonId: string,
    @Args('chunks') chunks: string[],
    @Context() ctx: LooseCtx,
  ) {
    const { userId } = actorOf(ctx);
    const r = await this.quiz.generate({ userId, lessonId, chunks });
    await this.answers.saveAnswers(
      r.quizId,
      r.questions.map((q) => q.correctIndex),
      3600,
    );
    const out = new AdaptiveQuizPayloadGql();
    out.quizId = r.quizId;
    out.lessonId = r.lessonId;
    out.level = r.level;
    out.questions = r.questions.map((q) => ({
      questionId: q.questionId,
      prompt: q.prompt,
      options: q.options,
      explanation: q.explanation,
    }));
    return out;
  }

  @Mutation('submitAdaptiveQuiz')
  async submitAdaptiveQuiz(
    @Args('quizId') quizId: string,
    @Args('lessonId') lessonId: string,
    @Args('answers') answers: number[],
    @Context() ctx: LooseCtx,
  ) {
    const { userId } = actorOf(ctx);
    const correctIndexes = await this.answers.takeAnswers(quizId);
    if (!correctIndexes) throw new BadRequestException('Quiz expired or already submitted');
    const r = await this.quiz.submit({ userId, lessonId, answers, correctIndexes, weakTopic: lessonId });
    const out = new AdaptiveQuizResultGql();
    out.score = r.score;
    out.correct = r.correct;
    out.total = r.total;
    out.nextLevel = r.nextLevel;
    return out;
  }

  @Query('aiChatHistory')
  async aiChatHistory(@Args('sessionId') sessionId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    const db = this.prisma as unknown as {
      aiChatMessage: { findMany: (args: unknown) => Promise<Array<{ id: string; sender: string; content: string; createdAt: Date }>> };
    };
    const rows = await db.aiChatMessage
      .findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 50 })
      .catch(() => []);
    return rows.map((m) => {
      const out = new AiChatMessageItemGql();
      out.messageId = m.id;
      out.sender = m.sender;
      out.content = m.content;
      out.createdAt = new Date(m.createdAt).toISOString();
      return out;
    });
  }
}

export { AiChatResponseGql, AdaptiveQuizPayloadGql, AdaptiveQuizResultGql };
