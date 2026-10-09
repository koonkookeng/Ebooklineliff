// SSOT Phase 091 — Vector search + AI ask client (REST transport)
// Canonical: apps/frontend/lib/vector-search/vector-search-client.ts
// - Zero-dep (fetch only).
export type VectorSearchStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface VectorSearchItem {
  sourceType: string;
  sourceId: string;
  productId: string;
  productTitle: string;
  chunkIndex: number;
  contentText: string;
  similarityScore: number;
  pageNumber?: number;
  videoTimestampSec?: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`vector-search ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function vectorSearchApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    search: (body: { queryText: string; productIdFilter?: string; limit?: number }) =>
      post('/api/v1/vector-search/search', body) as Promise<{ items: VectorSearchItem[]; tookMs: number }>,
    ask: (body: { productId: string; userQuestion: string; currentPage?: number }) =>
      post('/api/v1/vector-search/ask', body) as Promise<{ answer: string; referencedPages: number[] }>,
  };
}
