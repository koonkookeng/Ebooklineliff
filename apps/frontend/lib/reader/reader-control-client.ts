// SSOT Phase 041 — Reader control transport (Next proxy wrappers)
// Canonical: apps/frontend/lib/reader/reader-control-client.ts
// - Thin fetch wrappers over app/api/v1/reader-control/* (JWT passthrough
//   server-side). Failures throw typed Errors so callers enter ERROR + IDB.
// - Zero new deps.
import type { CreateBookmarkInput, CreateHighlightInput, ReaderPreference } from '@repo/shared';

async function asJson(res: Response, what: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${what} failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export function fetchAnnotations(productId: string): Promise<{ bookmarks: never[]; highlights: never[] } | unknown> {
  return fetch(`/api/v1/reader-control/annotations?productId=${encodeURIComponent(productId)}`).then((res) =>
    asJson(res, 'Load annotations'),
  );
}

export function toggleBookmarkRemote(input: CreateBookmarkInput): Promise<{ isBookmarked: boolean; bookmark: unknown }> {
  return fetch('/api/v1/reader-control/bookmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => asJson(res, 'Toggle bookmark') as Promise<{ isBookmarked: boolean; bookmark: unknown }>);
}

export function saveHighlightRemote(
  input: CreateHighlightInput,
): Promise<{ id: string; pageNumber: number; colorHex: string; boundingRectsJson: string; selectedText: string; noteText: string | null }> {
  return fetch('/api/v1/reader-control/highlight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(
    (res) =>
      asJson(res, 'Save highlight') as Promise<{
        id: string;
        pageNumber: number;
        colorHex: string;
        boundingRectsJson: string;
        selectedText: string;
        noteText: string | null;
      }>,
  );
}

export function deleteHighlightRemote(highlightId: string): Promise<{ success: boolean }> {
  return fetch(`/api/v1/reader-control/highlight?highlightId=${encodeURIComponent(highlightId)}`, {
    method: 'DELETE',
  }).then((res) => asJson(res, 'Delete highlight') as Promise<{ success: boolean }>);
}

export function fetchPreferences(): Promise<ReaderPreference> {
  return fetch('/api/v1/reader-control/preferences').then((res) => asJson(res, 'Load preferences') as Promise<ReaderPreference>);
}

export function savePreferencesRemote(input: ReaderPreference): Promise<ReaderPreference> {
  return fetch('/api/v1/reader-control/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => asJson(res, 'Save preferences') as Promise<ReaderPreference>);
}
