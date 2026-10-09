// SSOT Phase 092 BDD-2 — Adaptive quiz engine (deterministic generation + leveling)
// Canonical: apps/backend/src/modules/ai-companion/services/adaptive-quiz.service.ts
// - Generates 3 MCQs from lesson chunks (deterministic distractor engine —
//   zero new deps, no LLM egress). Difficulty follows the learner insight
//   level; submit grades + adapts the level atomically (Gate 7).
// - Port-based for DB-free tests.
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AI_STREAM, adaptLevel, comprehensionScore, type QuizLevel } from '@repo/shared';

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface QuizQuestion {
  questionId: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface InsightStorePort {
  getLevel(userId: string): Promise<QuizLevel>;
  saveResult(userId: string, args: { comprehensionRate: number; adaptedQuizLevel: QuizLevel; weakTopic: string }): Promise<void>;
}

export interface QuizBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

function keySentence(chunk: string, level: QuizLevel): string {
  const sentences = chunk.split(/(?<=[.!?।。…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 20);
  if (sentences.length === 0) return chunk.slice(0, 120);
  const sorted = [...sentences].sort((a, b) => {
    const score = (s: string): number =>
      s.length + (level === 'EASY' ? (s.includes('คือ') ? 50 : 0) : s.split(' ').length);
    return score(b) - score(a);
  });
  return sorted[0] ?? chunk.slice(0, 120);
}

@Injectable()
export class AdaptiveQuizService {
  constructor(
    private readonly insights: InsightStorePort,
    private readonly bus?: QuizBus,
  ) {}

  async generate(args: { userId: string; lessonId: string; chunks: string[] }): Promise<{
    quizId: string;
    lessonId: string;
    level: QuizLevel;
    questions: QuizQuestion[];
  }> {
    if (!args.lessonId) throw new BadRequestException('Missing lessonId');
    if (args.chunks.length === 0) throw new BadRequestException('No lesson content to quiz');
    const level = await this.insights.getLevel(args.userId).catch(() => 'MEDIUM' as QuizLevel);
    const pool = args.chunks.slice(0, 3);
    while (pool.length < 3) pool.push(args.chunks[0] ?? 'เนื้อหาบทเรียน');
    const questions = pool.slice(0, 3).map((chunk, i) => this.buildQuestion(chunk, pool, level, i));
    return { quizId: randomUUID(), lessonId: args.lessonId, level, questions };
  }

  async submit(args: {
    userId: string;
    lessonId: string;
    answers: number[];
    correctIndexes: number[];
    weakTopic: string;
  }): Promise<{ score: number; correct: number; total: number; nextLevel: QuizLevel }> {
    if (args.answers.length !== args.correctIndexes.length || args.answers.length === 0) {
      throw new BadRequestException('Answers do not match questions');
    }
    let correct = 0;
    for (let i = 0; i < args.answers.length; i++) {
      if (args.answers[i] === args.correctIndexes[i]) correct++;
    }
    const score = comprehensionScore(correct, args.answers.length);
    const current = await this.insights.getLevel(args.userId).catch(() => 'MEDIUM' as QuizLevel);
    const nextLevel = adaptLevel(current, score);
    await this.insights.saveResult(args.userId, {
      comprehensionRate: score,
      adaptedQuizLevel: nextLevel,
      weakTopic: correct === args.answers.length ? '' : args.weakTopic,
    });
    await this.bus
      ?.xadd(AI_STREAM, {
        event: 'adaptive_quiz_submitted',
        userId: args.userId,
        lessonId: args.lessonId,
        score,
        at: Date.now(),
      })
      .catch(() => undefined);
    return { score, correct, total: args.answers.length, nextLevel };
  }

  private buildQuestion(chunk: string, pool: string[], level: QuizLevel, seed: number): QuizQuestion {
    const key = keySentence(chunk, level);
    const span = key.split(' ').slice(0, level === 'EASY' ? 6 : 10).join(' ');
    const distractors = pool
      .filter((c) => c !== chunk)
      .map((c) => c.split(' ').slice(0, 6).join(' '))
      .concat(['ไม่มีข้อใดถูก', 'ถูกทุกข้อ', 'ต้องอาศัยบริบทเพิ่มเติม']);
    const options = [span, ...distractors.slice(0, 3)];
    // Deterministic rotation (no Math.random — reproducible + testable).
    const rot = hashStr(`${seed}:${span}`) % options.length;
    const rotated = [...options.slice(rot), ...options.slice(0, rot)];
    return {
      questionId: `q-${hashStr(span).toString(36)}`,
      prompt: level === 'EASY' ? `ข้อความใดกล่าวถึง: "${span.slice(0, 60)}…"?` : `แนวคิดสำคัญของข้อความนี้คืออะไร: "${span.slice(0, 80)}…"?`,
      options: rotated,
      correctIndex: rotated.indexOf(span),
      explanation: `อ้างอิง: ${key.slice(0, 160)}`,
    };
  }
}
