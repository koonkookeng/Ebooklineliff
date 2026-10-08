// SSOT Phase 074 §6/§10 — Builder client (draft autosave + publish)
// Canonical: apps/frontend/lib/builder/builder-client.ts
// - Draft save/load + atomic publish via Next proxies (auth passthrough).
// - Presign reuses the merchant studio endpoint? No — dedicated builder
//   presign (tenant-vaulted builder/ prefix, §8.1).
// - Zero-dep (fetch only).
import type { UniversalProductBuilderInput } from '@repo/shared';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`builder ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function builderApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    saveDraft: (body: { draftId?: string; stepIndex: number } & Record<string, unknown>) =>
      json<{ draftId: string }>(`/api/builder/draft/save?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    loadDraft: (draftId: string) =>
      json<{ stepIndex: number; payload: UniversalProductBuilderInput } | null>(
        `/api/builder/draft/load?${qs}&draftId=${encodeURIComponent(draftId)}`,
      ),
    publish: (body: UniversalProductBuilderInput) =>
      post(`/api/builder/publish?${qs}`, body) as Promise<{ productId: string; slug: string }>,
    presign: (body: { fileName: string; fileSize: number; contentType: string; kind: string }) =>
      post(`/api/builder/presign-upload?${qs}`, body) as Promise<{
        uploadUrl: string; objectKey: string; expiresInSeconds: number;
      }>,
  };
}
