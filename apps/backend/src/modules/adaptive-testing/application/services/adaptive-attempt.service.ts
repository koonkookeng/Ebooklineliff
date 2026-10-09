// SSOT Phase 093 BDD-1 — Adaptive attempt service (submit → θ → next)
// Canonical: apps/backend/src/modules/adaptive-testing/application/services/adaptive-attempt.service.ts
// - Flow: Zod gate (server trusts JWT userId, never client userId) → item +
//   profile fetch → duplicate guard → grade → θ step → ONE $transaction:
//   response row + profile upsert (Gate 7) → max-info next item → stream.
//   Pure calc stays <200ms (Gate 10).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADAPTIVE_STREAM,
  AdaptiveSubmitAnswerSchema,
  irtInformation,
  masteryPercent,
  selectNextItem,
  thetaStandardError,
  thetaStep,
} from '@repo/shared';
import { assertAnswerable, isSessionCompleted } from '../../domain/entities/adaptive-session.entity';
import type { AdaptiveRepository } from '../../domain/repository/adaptive.repository.interface';

export interface AdaptiveTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface AdaptiveBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface NextQuestionOut {
  questionId: string;
  questionText: string;
  options: Array<{ id: string; text: string }>;
  currentTheta: number;
  estimatedMasteryPercent: number;
  isTestCompleted: boolean;
}

@Injectable()
export class AdaptiveAttemptService {
  constructor(
    private readonly repo: AdaptiveRepository,
    private readonly tx: AdaptiveTx,
    private readonly bus?: AdaptiveBus,
  ) {}

  async start(args: { userId: string; lessonId: string }): Promise<NextQuestionOut> {
    if (!args.lessonId) throw new BadRequestException('Missing lessonId');
    const profile = await this.repo.getProfile(args.userId, args.lessonId);
    const items = await this.repo.getItems(args.lessonId);
    if (items.length === 0) throw new NotFoundException('No questions for this lesson');
    const answered = await this.repo.getAnsweredIds(args.userId, args.lessonId);
    const next = selectNextItem(profile.theta, items, answered);
    if (!next || isSessionCompleted({ answeredCount: answered.length, remainingItems: items.length - answered.length, standardError: profile.standardError })) {
      return this.completed(profile.theta);
    }
    return this.shape(next, profile.theta, false);
  }

  async submit(args: {
    userId: string;
    lessonId: string;
    questionId: string;
    selectedOptionId: string;
    responseTimeMs: number;
  }): Promise<NextQuestionOut> {
    const parsed = AdaptiveSubmitAnswerSchema.safeParse({ ...args, userId: args.userId });
    if (!parsed.success) throw new BadRequestException('Invalid adaptive answer');
    const t0 = Date.now();

    const item = await this.repo.getItem(parsed.data.questionId);
    if (!item || item.lessonId !== parsed.data.lessonId) throw new NotFoundException('Question not found');
    const profile = await this.repo.getProfile(args.userId, parsed.data.lessonId);
    const answered = await this.repo.getAnsweredIds(args.userId, parsed.data.lessonId);
    assertAnswerable(item.id, answered);

    const isCorrect = parsed.data.selectedOptionId === item.correctOption;
    const thetaAfter = thetaStep(profile.theta, item, isCorrect);
    const items = await this.repo.getItems(parsed.data.lessonId);
    const answeredNow = [...answered, item.id];
    const info = [...items]
      .filter((i) => answeredNow.includes(i.id))
      .reduce((n, i) => n + irtInformation(thetaAfter, i), 0);
    const se = thetaStandardError(info);
    const total = profile.totalQuestions + 1;

    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      await repo.saveResponse({
        userId: args.userId,
        questionId: item.id,
        selectedOption: parsed.data.selectedOptionId,
        isCorrect,
        responseTimeMs: parsed.data.responseTimeMs,
        thetaAfter,
      });
      await repo.saveProfile({
        userId: args.userId,
        subjectContext: parsed.data.lessonId,
        theta: thetaAfter,
        standardError: se,
        totalQuestions: total,
      });
    });

    const next = selectNextItem(thetaAfter, items, answeredNow);
    const done =
      !next ||
      isSessionCompleted({ answeredCount: total, remainingItems: next ? items.length - answeredNow.length : 0, standardError: se });
    await this.bus
      ?.xadd(ADAPTIVE_STREAM, {
        event: 'adaptive_theta_updated',
        userId: args.userId,
        lessonId: parsed.data.lessonId,
        theta: Math.round(thetaAfter * 1000) / 1000,
        isCorrect: isCorrect ? 1 : 0,
        tookMs: Date.now() - t0,
        at: Date.now(),
      })
      .catch(() => undefined);
    if (done || !next) return this.completed(thetaAfter);
    return this.shape(next, thetaAfter, false);
  }

  private shape(
    item: { id: string; questionText: string; optionsJson: Array<{ id: string; text: string }> },
    theta: number,
    completed: boolean,
  ): NextQuestionOut {
    return {
      questionId: item.id,
      questionText: item.questionText,
      options: item.optionsJson,
      currentTheta: Math.round(theta * 1000) / 1000,
      estimatedMasteryPercent: masteryPercent(theta),
      isTestCompleted: completed,
    };
  }

  private completed(theta: number): NextQuestionOut {
    return {
      questionId: '00000000-0000-0000-0000-000000000000',
      questionText: '',
      options: [],
      currentTheta: Math.round(theta * 1000) / 1000,
      estimatedMasteryPercent: masteryPercent(theta),
      isTestCompleted: true,
    };
  }
}
