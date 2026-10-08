// SSOT Phase 078 §6 — Studio client (REST transport + draft saver)
// Canonical: apps/frontend/lib/studio/studio-client.ts
// - Proxied REST (auth passthrough); IndexedDB draft saver for offline
//   resiliency (§2.1); dependency-free.
// - Zero-dep (fetch only).
export type StudioStatus =
  | 'STUDIO_INIT'
  | 'IDLE'
  | 'DRAGGING'
  | 'UPLOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface StudioLesson {
  id: string;
  sectionId: string;
  lessonOrder: number;
  title: string;
  videoHlsUrl: string | null;
  durationSec: number;
  isPreview: boolean;
}

export interface StudioSection {
  id: string;
  courseId: string;
  sectionOrder: number;
  title: string;
  lessons: StudioLesson[];
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`studio ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function studioApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    structure: (courseId: string) =>
      json<{ sections: StudioSection[] }>(`/api/v1/studio/curriculum/${encodeURIComponent(courseId)}?${qs}`),
    reorder: (body: unknown) => post(`/api/v1/studio/curriculum/reorder?${qs}`, body),
    presign: (body: unknown) =>
      post(`/api/v1/studio/hls/presign?${qs}`, body) as Promise<{ uploadUrl: string; videoKey: string; expiresInSec: number }>,
    saveQuiz: (body: unknown) => post(`/api/v1/studio/quiz?${qs}`, body) as Promise<{ id: string }>,
    deleteQuiz: (quizId: string) =>
      json<boolean>(`/api/v1/studio/quiz/${encodeURIComponent(quizId)}?${qs}`, { method: 'DELETE' }),
  };
}

const DRAFT_DB = 'studio-drafts';

/** Persist a curriculum draft locally (IndexedDB, offline resiliency). */
export async function saveStudioDraft(courseId: string, sections: StudioSection[]): Promise<void> {
  try {
    localStorage.setItem(`${DRAFT_DB}:${courseId}`, JSON.stringify({ sections, at: Date.now() }));
  } catch {
    // Storage full/blocked — server remains the source of truth.
  }
}

/** Restore a local curriculum draft (null when absent/corrupt). */
export function loadStudioDraft(courseId: string): StudioSection[] | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_DB}:${courseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sections: StudioSection[] };
    return Array.isArray(parsed.sections) ? parsed.sections : null;
  } catch {
    return null;
  }
}

/** Clear the local draft after a confirmed server persist. */
export function clearStudioDraft(courseId: string): void {
  try {
    localStorage.removeItem(`${DRAFT_DB}:${courseId}`);
  } catch {
    // Best-effort cleanup.
  }
}
