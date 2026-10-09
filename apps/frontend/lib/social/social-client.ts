// SSOT Phase 095 — Social reading client (REST transport)
// Canonical: apps/frontend/lib/social/social-client.ts
// - Zero-dep (fetch only).
export type SocialReadingStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface PageNote {
  id: string;
  userDisplayName: string;
  isAuthorNote: boolean;
  pageNumber: number;
  positionX: number;
  positionY: number;
  content: string;
  likesCount: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`social-notes ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function socialApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    page: (ebookId: string, pageNumber: number) =>
      json<PageNote[]>(`/api/v1/social-notes/page?ebookId=${encodeURIComponent(ebookId)}&page=${pageNumber}`),
    create: (body: {
      ebookId: string; pageNumber: number; positionX: number; positionY: number;
      selectedText?: string; content: string; visibility: string; noteType: string; studyGroupId?: string;
    }) => post('/api/v1/social-notes/create', body) as Promise<{ noteId: string; flexMessageJson: string }>,
    like: (body: { noteId: string; ebookId: string; pageNumber: number }) =>
      post('/api/v1/social-notes/like', body) as Promise<{ liked: boolean; likesCount: number }>,
  };
}
