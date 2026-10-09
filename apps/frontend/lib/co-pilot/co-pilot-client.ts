// SSOT Phase 094 — Co-pilot client (REST + SSE transport)
// Canonical: apps/frontend/lib/co-pilot/co-pilot-client.ts
// - Zero-dep (fetch + manual SSE reader).
export type CoPilotStatus =
  | 'INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface OutlineSection {
  sectionTitle: string;
  lessons: Array<{ lessonTitle: string; outcome: string }>;
}

export interface SubtitleCue {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`co-pilot ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function coPilotApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    outline: (body: { topic: string; targetAudience: string; difficultyLevel: string; numberOfSections?: number }) =>
      post('/api/v1/copilot/outline', body) as Promise<{ jobId: string; sections: OutlineSection[] }>,
    transcribe: (body: { lessonId: string; transcriptText: string; durationSec: number }) =>
      post('/api/v1/copilot/transcribe', body) as Promise<{ jobId: string; queued: number }>,
    job: (jobId: string) =>
      json<{ status: string; progressPercent: number; errorMessage: string | null }>(
        `/api/v1/copilot/job?jobId=${encodeURIComponent(jobId)}`,
      ),
    quizFromTranscript: (body: { lessonId: string; transcriptText: string }) =>
      post('/api/v1/copilot/quiz-from-transcript', body) as Promise<{
        saved: number;
        questions: Array<{ question: string; options: string[]; correctOptionIndex: number; explanation: string }>;
      }>,
    subtitleTicket: (lessonId: string) =>
      json<{ ticket: string; exp: number }>(`/api/v1/subtitles/ticket?lessonId=${encodeURIComponent(lessonId)}`),
  };
}

/** Manual SSE reader for outline streaming. */
export async function readOutlineStream(
  topic: string,
  onSection: (section: OutlineSection) => void,
): Promise<{ jobId?: string }> {
  const res = await fetch(`/api/v1/copilot/outline-stream?topic=${encodeURIComponent(topic)}`, {
    headers: { Accept: 'text/event-stream' },
  });
  if (!res.ok || !res.body) throw new Error(`outline-stream ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let meta: { jobId?: string } = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim()) as
          | { type: 'start'; jobId: string }
          | { type: 'token'; section: OutlineSection }
          | { type: 'done'; jobId: string }
          | { type: 'error'; message: string };
        if (evt.type === 'token') onSection(evt.section);
        else if (evt.type === 'start' || evt.type === 'done') meta = { jobId: evt.jobId };
        else if (evt.type === 'error') throw new Error(evt.message);
      } catch (e) {
        if ((e as Error).message !== 'Unexpected end of JSON input') throw e;
      }
    }
  }
  return meta;
}
