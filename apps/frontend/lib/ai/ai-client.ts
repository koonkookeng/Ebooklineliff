// SSOT Phase 092 — AI companion client (REST + SSE transport)
// Canonical: apps/frontend/lib/ai/ai-client.ts
// - Zero-dep (fetch + EventSource-free manual SSE reader).
export type AiCompanionStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface AiCitation {
  pageNumber?: number;
  timestampSec?: number;
  snippetText: string;
}

export interface AiChatResult {
  sessionId: string;
  messageId: string;
  answerMarkdown: string;
  citations: AiCitation[];
  tokenUsed: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`ai-companion ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function aiClient() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    chat: (body: { productId: string; userQuestion: string; currentPage?: number; sessionId?: string }) =>
      post('/api/v1/ai/chat', body) as Promise<AiChatResult>,
    summarize: (body: { productId: string; sourceType: string; targetPage?: number; lessonId?: string }) =>
      post('/api/v1/ai/summarize', body) as Promise<{ summary: string; citations: AiCitation[] }>,
    quizGenerate: (body: { lessonId: string; chunks: string[] }) =>
      post('/api/v1/ai/quiz/generate', body) as Promise<{
        quizId: string;
        lessonId: string;
        level: string;
        questions: Array<{ questionId: string; prompt: string; options: string[]; explanation: string }>;
      }>,
    quizSubmit: (body: { quizId: string; lessonId: string; answers: number[] }) =>
      post('/api/v1/ai/quiz/submit', body) as Promise<{ score: number; correct: number; total: number; nextLevel: string }>,
  };
}

/** Manual SSE reader (no EventSource — works with POST-less GET streams). */
export async function readSseStream(
  url: string,
  onToken: (text: string) => void,
): Promise<{ sessionId?: string; messageId?: string; citations?: AiCitation[] }> {
  const res = await fetch(url, { headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`ai-stream ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let meta: { sessionId?: string; messageId?: string; citations?: AiCitation[] } = {};
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
          | { type: 'start'; sessionId: string }
          | { type: 'token'; text: string }
          | { type: 'done'; messageId: string; citations: AiCitation[] }
          | { type: 'error'; message: string };
        if (evt.type === 'token') onToken(evt.text);
        else if (evt.type === 'start') meta = { ...meta, sessionId: evt.sessionId };
        else if (evt.type === 'done') meta = { ...meta, messageId: evt.messageId, citations: evt.citations };
        else if (evt.type === 'error') throw new Error(evt.message);
      } catch (e) {
        if ((e as Error).message !== 'Unexpected end of JSON input') throw e;
      }
    }
  }
  return meta;
}
