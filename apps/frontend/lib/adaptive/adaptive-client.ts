// SSOT Phase 093 — Adaptive testing client (REST transport)
// Canonical: apps/frontend/lib/adaptive/adaptive-client.ts
// - Zero-dep (fetch only).
export type AdaptiveStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface AdaptiveOption {
  id: string;
  text: string;
}

export interface AdaptiveQuestion {
  questionId: string;
  questionText: string;
  options: AdaptiveOption[];
  currentTheta: number;
  estimatedMasteryPercent: number;
  isTestCompleted: boolean;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`adaptive ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function adaptiveApi() {
  return {
    next: (lessonId: string) =>
      json<AdaptiveQuestion>(`/api/v1/adaptive/next?lessonId=${encodeURIComponent(lessonId)}`),
    submit: (body: { lessonId: string; questionId: string; selectedOptionId: string; responseTimeMs: number }) =>
      json<AdaptiveQuestion>('/api/v1/adaptive/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
