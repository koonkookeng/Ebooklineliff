// SSOT Phase 047 — Quiz transport (Next proxy wrappers)
// Canonical: apps/frontend/lib/quiz/quiz-client.ts
// - fetchCheckpoints (sanitized, Gate 4) + submitQuizAnswer (zero-trust).
// - Zero new deps.
import type { QuizCheckpoint, QuizEvaluationResult, SubmitQuizAnswerInput } from '@repo/shared';

async function asJson(res: Response, what: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${what} failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export function fetchCheckpoints(lessonId: string): Promise<QuizCheckpoint[]> {
  return fetch(`/api/v1/quiz/checkpoints?lessonId=${encodeURIComponent(lessonId)}`).then((res) =>
    asJson(res, 'Load quizzes') as Promise<QuizCheckpoint[]>,
  );
}

export function submitQuizAnswer(input: SubmitQuizAnswerInput): Promise<QuizEvaluationResult> {
  return fetch('/api/v1/quiz/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => asJson(res, 'Submit quiz answer') as Promise<QuizEvaluationResult>);
}
