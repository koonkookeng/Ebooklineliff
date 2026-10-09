// SSOT Phase 093 §3.1 — AI Adaptive Testing (IRT 3PL) contract
// Canonical: packages/shared/src/schemas/adaptive-testing-contract.ts
// - Spec-verbatim: AdaptiveSubmitAnswerSchema / AdaptiveNextQuestionSchema
//   (§3.1). 3PL Item Response Theory: P = c + (1-c)/(1+e^(-a(θ-b))).
// - RISK_CALL (documented): theta update is a bounded likelihood step
//   (lr=0.5·a·(correct−P), clamp ±4) — online EAP approximation, no
//   iterative MLE solver (keeps <200ms budget, Gate 10). Mastery% =
//   logistic(θ)·100. Completion: 10 items or SE < 0.3.
// - Pure helpers: 3PL probability/information, theta step, SE, mastery,
//   next-item selection (max info near θ), budgets, stream. Zod only.
import { z } from 'zod';

export const AdaptiveSubmitAnswerSchema = z.object({
  userId: z.string().uuid(),
  lessonId: z.string().uuid(),
  questionId: z.string().uuid(),
  selectedOptionId: z.string(),
  responseTimeMs: z.number().int().nonnegative(),
});
export type AdaptiveSubmitAnswer = z.infer<typeof AdaptiveSubmitAnswerSchema>;

export const AdaptiveOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
});
export type AdaptiveOption = z.infer<typeof AdaptiveOptionSchema>;

export const AdaptiveNextQuestionSchema = z.object({
  questionId: z.string().uuid(),
  questionText: z.string(),
  options: z.array(AdaptiveOptionSchema),
  currentTheta: z.number(),
  estimatedMasteryPercent: z.number(),
  isTestCompleted: z.boolean(),
});
export type AdaptiveNextQuestion = z.infer<typeof AdaptiveNextQuestionSchema>;

/** Max items per adaptive session before forced completion. */
export const ADAPTIVE_MAX_ITEMS = 10;
/** Completion when measurement SE drops below this. */
export const ADAPTIVE_SE_THRESHOLD = 0.3;
/** Per-submit calc budget: < 200ms (§10). */
export const ADAPTIVE_CALC_BUDGET_MS = 200;
/** Theta clamp bounds (EAP prior support). */
export const THETA_MIN = -4;
export const THETA_MAX = 4;
/** Adaptive event stream (Gate 8). */
export const ADAPTIVE_STREAM = 'stream:adaptive:theta';

export interface ItemParams {
  difficulty: number;
  discrimination: number;
  pseudoGuessing: number;
}

/** 3PL probability of a correct response at ability theta. */
export function irtProbability(theta: number, item: ItemParams): number {
  const a = Math.max(0.1, item.discrimination);
  const c = Math.min(0.5, Math.max(0, item.pseudoGuessing));
  const p = c + (1 - c) / (1 + Math.exp(-a * (theta - item.difficulty)));
  return Math.min(0.999, Math.max(0.001, p));
}

/** Fisher information of an item at ability theta. */
export function irtInformation(theta: number, item: ItemParams): number {
  const p = irtProbability(theta, item);
  const c = Math.min(0.5, Math.max(0, item.pseudoGuessing));
  const a = Math.max(0.1, item.discrimination);
  if (p <= 0 || p >= 1 || 1 - c <= 0) return 0;
  const q = ((p - c) / (1 - c)) ** 2;
  return (a * a * q * (1 - p)) / p;
}

/** Bounded likelihood theta step after one response. */
export function thetaStep(theta: number, item: ItemParams, isCorrect: boolean, lr = 0.5): number {
  const a = Math.max(0.1, item.discrimination);
  const p = irtProbability(theta, item);
  const next = theta + lr * a * ((isCorrect ? 1 : 0) - p);
  return Math.min(THETA_MAX, Math.max(THETA_MIN, next));
}

/** Standard error from accumulated information. */
export function thetaStandardError(totalInformation: number): number {
  if (totalInformation <= 0) return 1.0;
  return 1 / Math.sqrt(totalInformation);
}

/** Estimated mastery percent from theta. */
export function masteryPercent(theta: number): number {
  return Math.round((100 / (1 + Math.exp(-theta))) * 10) / 10;
}

/** Pick the unanswered item with max information at theta. */
export function selectNextItem<T extends ItemParams & { id: string }>(
  theta: number,
  items: T[],
  answeredIds: Set<string> | string[],
): T | null {
  const answered = Array.isArray(answeredIds) ? new Set(answeredIds) : answeredIds;
  let best: T | null = null;
  let bestInfo = -1;
  for (const item of items) {
    if (answered.has(item.id)) continue;
    const info = irtInformation(theta, item);
    if (info > bestInfo) {
      bestInfo = info;
      best = item;
    }
  }
  return best;
}
