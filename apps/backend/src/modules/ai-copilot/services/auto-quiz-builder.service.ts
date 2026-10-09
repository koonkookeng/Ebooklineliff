// SSOT Phase 094 Task 7 — Auto quiz builder (transcript → persisted quizzes)
// Canonical: apps/backend/src/modules/ai-copilot/services/auto-quiz-builder.service.ts
// - Deterministic 3-question picker from transcript sentences (zero new
//   deps); persists AiGeneratedQuiz rows in ONE $transaction (Gate 7).
// - Port-based for DB-free tests.
import { BadRequestException, Injectable } from '@nestjs/common';
import { COPILOT_STREAM, GeneratedQuizQuestionSchema } from '@repo/shared';

export interface QuizPersistTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface QuizPersistStore {
  saveQuizzes(
    tx: unknown,
    rows: Array<{ lessonId: string; question: string; optionsJson: string[]; answerIndex: number; explanation: string }>,
  ): Promise<number>;
}

export interface QuizBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

function pickSentences(transcript: string, count: number): string[] {
  const sentences = transcript
    .split(/(?<=[.!?।。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);
  const ranked = [...sentences].sort((a, b) => b.length - a.length);
  return ranked.slice(0, count);
}

@Injectable()
export class AutoQuizBuilderService {
  constructor(
    private readonly store: QuizPersistStore,
    private readonly tx: QuizPersistTx,
    private readonly bus?: QuizBus,
  ) {}

  async buildFromTranscript(args: { lessonId: string; transcriptText: string }): Promise<{
    saved: number;
    questions: Array<{ question: string; options: string[]; correctOptionIndex: number; explanation: string }>;
  }> {
    if (!args.lessonId) throw new BadRequestException('Missing lessonId');
    const sentences = pickSentences(args.transcriptText, 3);
    if (sentences.length === 0) throw new BadRequestException('Transcript too short for quiz');
    const questions = sentences.map((s, i) => {
      const span = s.split(' ').slice(0, 8).join(' ');
      const q = {
        question: `แนวคิดสำคัญของประโยคที่ ${i + 1} คืออะไร: "${span}…"`,
        options: [span, 'ไม่มีข้อใดถูก', 'ถูกทุกข้อ', 'ต้องอาศัยบริบทเพิ่มเติม'].slice(0, 4),
        correctOptionIndex: 0,
        explanation: `อ้างอิง: ${s.slice(0, 160)}`,
      };
      const parsed = GeneratedQuizQuestionSchema.safeParse(q);
      if (!parsed.success) throw new BadRequestException('Generated quiz failed validation');
      return parsed.data;
    });
    const saved = await this.tx.run((tx) =>
      this.store.saveQuizzes(
        tx,
        questions.map((q) => ({
          lessonId: args.lessonId,
          question: q.question,
          optionsJson: q.options,
          answerIndex: q.correctOptionIndex,
          explanation: q.explanation,
        })),
      ),
    );
    await this.bus
      ?.xadd(COPILOT_STREAM, { event: 'quiz_generated', lessonId: args.lessonId, saved, at: Date.now() })
      .catch(() => undefined);
    return { saved, questions };
  }
}
