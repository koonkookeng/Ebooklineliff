// SSOT Phase 078 §2.2 — Studio workspace hook (5-state machine)
// Canonical: apps/frontend/hooks/useCourseStudio.ts
// - STUDIO_INIT on mount -> IDLE -> SUCCESS / ERROR + retry; draft fallback
//   when the server is unreachable (offline resiliency).
// - Zero-dep beyond the studio client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadStudioDraft, studioApi, type StudioSection, type StudioStatus } from '../lib/studio/studio-client';

export function useCourseStudio(slug: string, courseId: string) {
  const [status, setStatus] = useState<StudioStatus>('STUDIO_INIT');
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<StudioSection[]>([]);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!courseId) {
      setStatus('IDLE');
      return;
    }
    setStatus((s) => (s === 'STUDIO_INIT' ? s : 'IDLE'));
    setError(null);
    try {
      const data = await studioApi(slug).structure(courseId);
      setSections(data.sections);
      setStatus('SUCCESS');
    } catch (e) {
      const draft = loadStudioDraft(courseId);
      if (draft) {
        setSections(draft);
        setStatus('SUCCESS');
      } else {
        setError((e as Error).message);
        setStatus('ERROR');
      }
    }
  }, [slug, courseId, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, error, sections, retry: () => setNonce((n) => n + 1), reload: load };
}
