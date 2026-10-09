// SSOT Phase 099 — Live client (REST + SSE transport)
// Canonical: apps/frontend/lib/live/live-client.ts
// - Zero-dep (fetch + EventSource only; no amazon-ivs-player — RAM guard).
export type LiveStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface LiveAccess {
  sessionId: string;
  vendor: string;
  playbackUrl: string;
  playbackToken?: string;
  watermarkData: { text: string; userIdHash: string; timestamp: string };
  expiresAt: string;
}

export interface LiveChatItem {
  messageId: string;
  sessionId: string;
  userId: string;
  content: string;
  timestamp: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`live ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function liveApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    join: (sessionId: string) => post('/api/v1/live/join', { sessionId }) as Promise<LiveAccess>,
    chatHistory: (sessionId: string) =>
      json<LiveChatItem[]>(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/chat`),
    postChat: (sessionId: string, content: string) =>
      post(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/chat`, { content }) as Promise<{ messageId: string }>,
    vote: (pollId: string, optionId: string) =>
      post('/api/v1/live/polls/vote', { pollId, optionId }) as Promise<Array<{ optionId: string; votes: number }>>,
    chatStream: (sessionId: string) =>
      new EventSource(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/chat/stream`),
  };
}
