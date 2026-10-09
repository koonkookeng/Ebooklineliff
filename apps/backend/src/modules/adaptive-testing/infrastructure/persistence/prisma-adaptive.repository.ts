// SSOT Phase 093 — Prisma adaptive repository (structural adapter)
// Canonical: apps/backend/src/modules/adaptive-testing/infrastructure/persistence/prisma-adaptive.repository.ts
// - Response + profile mutations run inside caller-owned $transactions
//   (Gate 7); this adapter only shapes rows. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type {
  AdaptiveItemRow,
  AdaptiveProfileRow,
  AdaptiveRepository,
} from '../../domain/repository/adaptive.repository.interface';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function mapItem(r: Record<string, unknown>): AdaptiveItemRow {
  return {
    id: String(r['id']),
    lessonId: String(r['lessonId']),
    questionText: String(r['questionText']),
    optionsJson: r['optionsJson'] as Array<{ id: string; text: string }>,
    correctOption: String(r['correctOption']),
    difficulty: Number(r['difficulty']),
    discrimination: Number(r['discrimination']),
    pseudoGuessing: Number(r['pseudoGuessing']),
  };
}

function toRepo(db: Db): AdaptiveRepository {
  const items = db['adaptiveQuestionItem'];
  const profiles = db['userAdaptiveProfile'];
  const responses = db['adaptiveQuizResponse'];
  return {
    async getItems(lessonId: string): Promise<AdaptiveItemRow[]> {
      const rows = (await items.findMany({
        where: { lessonId },
        orderBy: { difficulty: 'asc' },
      }).catch(() => [])) as unknown as Record<string, unknown>[];
      return (rows as Record<string, unknown>[]).map(mapItem);
    },

    async getItem(questionId: string): Promise<AdaptiveItemRow | null> {
      const row = (await items.findUnique({ where: { id: questionId } }).catch(() => null)) as unknown as Record<string, unknown> | null;
      return row ? mapItem(row as Record<string, unknown>) : null;
    },

    async getProfile(userId: string, subjectContext: string): Promise<AdaptiveProfileRow> {
      const row = (await profiles.findUnique({ where: { userId_subjectContext: { userId, subjectContext } } }).catch(() => null)) as unknown as {
        theta: number; standardError: number; totalQuestions: number;
      } | null;
      return {
        userId,
        subjectContext,
        theta: row?.theta ?? 0,
        standardError: row?.standardError ?? 1,
        totalQuestions: row?.totalQuestions ?? 0,
      };
    },

    async saveProfile(profile: AdaptiveProfileRow): Promise<AdaptiveProfileRow> {
      await profiles.upsert({
        where: { userId_subjectContext: { userId: profile.userId, subjectContext: profile.subjectContext } },
        update: { theta: profile.theta, standardError: profile.standardError, totalQuestions: profile.totalQuestions },
        create: { ...profile },
      });
      return profile;
    },

    async saveResponse(args): Promise<void> {
      await responses.create({ data: { ...args } });
    },

    async getAnsweredIds(userId: string, lessonId: string): Promise<string[]> {
      const rows = (await responses.findMany({ where: { userId, question: { lessonId } }, select: { questionId: true } }).catch(() => [])) as unknown as Array<{ questionId: string }>;
      return (rows as Array<{ questionId: string }>).map((r) => r.questionId);
    },
  };
}

@Injectable()
export class PrismaAdaptiveRepository implements AdaptiveRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): AdaptiveRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): AdaptiveRepository {
    return toRepo(tx as Db);
  }

  getItems(lessonId: string) { return this.root.getItems(lessonId); }
  getItem(questionId: string) { return this.root.getItem(questionId); }
  getProfile(userId: string, subjectContext: string) { return this.root.getProfile(userId, subjectContext); }
  saveProfile(profile: AdaptiveProfileRow) { return this.root.saveProfile(profile); }
  saveResponse(args: {
    userId: string; questionId: string; selectedOption: string;
    isCorrect: boolean; responseTimeMs: number; thetaAfter: number;
  }) { return this.root.saveResponse(args); }
  getAnsweredIds(userId: string, lessonId: string) { return this.root.getAnsweredIds(userId, lessonId); }
}
