// SSOT Phase 099 + Phase 101 — Live client (REST + SSE transport)
// Canonical: apps/frontend/lib/live/live-client.ts
// - Zero-dep (fetch + EventSource only — RAM guard).
// - 101 adds the interaction surface (room stream, enriched chat, polls v2,
//   hand-raise, viewers) via extendLiveApi (099 shape untouched).
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

export interface LivePollWidget {
  pollId: string;
  question: string;
  options: Array<{ optionId: string; text: string; votes: number; percentage: number }>;
  totalVotes: number;
  isActive: boolean;
}

export function extendLiveApi() {
  const base = liveApi();
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    ...base,
    roomStream: (sessionId: string, token: string) =>
      new EventSource(
        `/api/v1/live/sessions/${encodeURIComponent(sessionId)}/room/stream?token=${encodeURIComponent(token)}`,
      ),
    chatEnriched: (sessionId: string) =>
      json(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/chat/enriched`),
    sendChat: (sessionId: string, body: { content: string; messageType?: string; stickerPackageId?: string; stickerId?: string }) =>
      post(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/chat/send`, body),
    createPoll: (sessionId: string, body: { question: string; options: string[]; durationSec: number }) =>
      post(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/polls`, body) as Promise<LivePollWidget>,
    votePoll2: (pollId: string, optionId: string) =>
      post(`/api/v1/live/polls/${encodeURIComponent(pollId)}/vote2`, { optionId }) as Promise<LivePollWidget>,
    pollResults: (pollId: string) =>
      json(`/api/v1/live/polls/${encodeURIComponent(pollId)}/results`) as Promise<LivePollWidget>,
    raiseHand: (sessionId: string) =>
      post(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/raise`, {}) as Promise<{ queuePosition: number }>,
    raiseQueue: (sessionId: string) =>
      json(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/raise-queue`),
    viewerJoin: (sessionId: string) =>
      post(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/viewers/join`, {}),
    viewerLeave: (sessionId: string) =>
      post(`/api/v1/live/sessions/${encodeURIComponent(sessionId)}/viewers/leave`, {}),
  };
}
