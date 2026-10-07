// SSOT Phase 045 Task 5 — Lesson stream client (state + heartbeat transport)
// Canonical: apps/frontend/lib/stream/lesson-stream-client.ts
// - fetchLessonState: one call returns manifest + resume + watermark.
// - reportLessonHeartbeat: 5s cadence POST (server upserts + heatmap event).
// - Zero new deps.
import type { LessonStreamPayload, SyncLessonProgress } from '@repo/shared';

async function asJson(res: Response, what: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${what} failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export function fetchLessonState(lessonId: string): Promise<LessonStreamPayload> {
  return fetch(`/api/v1/stream/lesson-state?lessonId=${encodeURIComponent(lessonId)}`).then((res) =>
    asJson(res, 'Load lesson stream') as Promise<LessonStreamPayload>,
  );
}

export function reportLessonHeartbeat(input: SyncLessonProgress): Promise<{ success: boolean; isCompleted: boolean }> {
  return fetch('/api/v1/stream/lesson-progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => asJson(res, 'Sync lesson progress') as Promise<{ success: boolean; isCompleted: boolean }>);
}
