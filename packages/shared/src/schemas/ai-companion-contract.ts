// SSOT Phase 092 §3 — AI Companion Zod domain contract
// Canonical: packages/shared/src/schemas/ai-companion-contract.ts
// - Spec-verbatim: AiContextSourceEnum / AiSummaryRequestSchema /
//   AiChatQuerySchema / AiChatResponseSchema / AdaptiveQuizSchema (§3).
// - RISK_CALL (documented): vector storage reuses Phase 091
//   ContentVectorEmbedding (no duplicate pgvector table/index).
//   Difficulty ladder EASY→MEDIUM→HARD; semantic cache hit > 0.95 (§8).
//   TTFT < 1.5s, stream completion < 5s (§10).
// - Pure helpers: difficulty ladder, cache key, injection patterns,
//   DRM caps, token estimate, stream chunker. Zod only.
import { z } from 'zod';

export const AiContextSourceEnum = z.enum(['EBOOK_PAGE', 'EBOOK_CHUNK', 'EBOOK_CHAPTER', 'COURSE_LESSON_TRANSCRIPT', 'GLOBAL_BOOK_INDEX']);
export type AiContextSource = z.infer<typeof AiContextSourceEnum>;

export const AiSummaryRequestSchema = z.object({
  productId: z.string().uuid(),
  sourceType: AiContextSourceEnum,
  targetPage: z.number().int().positive().optional(),
  lessonId: z.string().uuid().optional(),
  language: z.enum(['TH', 'EN']).default('TH'),
});
export type AiSummaryRequest = z.infer<typeof AiSummaryRequestSchema>;

export const AiChatQuerySchema = z.object({
  sessionId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  userQuestion: z.string().min(1).max(1000),
  currentPage: z.number().int().positive().optional(),
  currentLessonSec: z.number().int().nonnegative().optional(),
});
export type AiChatQuery = z.infer<typeof AiChatQuerySchema>;

export const AiCitationSchema = z.object({
  pageNumber: z.number().optional(),
  timestampSec: z.number().optional(),
  snippetText: z.string(),
});
export type AiCitation = z.infer<typeof AiCitationSchema>;

export const AiChatResponseSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  answerMarkdown: z.string(),
  citations: z.array(AiCitationSchema),
  tokenUsed: z.number().int(),
});
export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

export const AdaptiveQuizQuestionSchema = z.object({
  questionId: z.string(),
  prompt: z.string(),
  options: z.array(z.string()),
  explanation: z.string(),
});
export type AdaptiveQuizQuestion = z.infer<typeof AdaptiveQuizQuestionSchema>;

export const AdaptiveQuizSchema = z.object({
  quizId: z.string().uuid(),
  lessonId: z.string().uuid(),
  questions: z.array(AdaptiveQuizQuestionSchema),
});
export type AdaptiveQuiz = z.infer<typeof AdaptiveQuizSchema>;

/** Difficulty ladder (UserLearningInsight.adaptedQuizLevel). */
export const QuizLevelEnum = z.enum(['EASY', 'MEDIUM', 'HARD']);
export type QuizLevel = z.infer<typeof QuizLevelEnum>;

/** DRM: max context chunks per answer (§8, ≤3 chunks / 1500 tokens). */
export const AI_MAX_CONTEXT_CHUNKS = 3;
/** Semantic cache hit threshold: cosine > 0.95 (§8). */
export const SEMANTIC_CACHE_THRESHOLD = 0.95;
/** Latency budgets: TTFT < 1.5s, completion < 5s (§10). */
export const AI_TTFT_BUDGET_MS = 1500;
export const AI_COMPLETION_BUDGET_MS = 5000;
/** Fallback switch budget: 500ms (§10). */
export const AI_FALLBACK_BUDGET_MS = 500;
/** Companion event stream (Gate 8). */
export const AI_STREAM = 'stream:ai:companion';

/** Step difficulty up/down one rung based on score (0-100). */
export function adaptLevel(current: QuizLevel, scorePct: number): QuizLevel {
  if (scorePct >= 80) return current === 'EASY' ? 'MEDIUM' : 'HARD';
  if (scorePct <= 40) return current === 'HARD' ? 'MEDIUM' : 'EASY';
  return current;
}

/** Semantic-cache key for a tenant-scoped question. */
export function semanticCacheKey(tenantId: string, productId: string, question: string): string {
  let h = 2166136261;
  const s = `${tenantId}:${productId}:${question.trim().toLowerCase()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `semcache:${tenantId}:${(h >>> 0).toString(36)}`;
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Split an answer into SSE word-batches (streaming UI). */
export function toStreamBatches(answer: string, wordsPerBatch = 8): string[] {
  const words = answer.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerBatch) {
    out.push(words.slice(i, i + wordsPerBatch).join(' '));
  }
  return out.length > 0 ? out : [''];
}

/** Comprehension score 0-100 from correct/total. */
export function comprehensionScore(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100);
}
