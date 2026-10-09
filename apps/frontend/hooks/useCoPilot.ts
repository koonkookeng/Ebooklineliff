// SSOT Phase 094 BDD-1 — Co-pilot studio hook (INIT/IDLE/LOADING/SUCCESS/ERROR)
// Canonical: apps/frontend/hooks/useCoPilot.ts
// - Streams outline sections via SSE with JSON fallback; polls transcribe
//   jobs by progress bands. Zero-dep beyond the co-pilot client.
'use client';

import { useCallback, useState } from 'react';
import { coPilotApi, readOutlineStream, type CoPilotStatus, type OutlineSection } from '../lib/co-pilot/co-pilot-client';

export function useCoPilot() {
  const [status, setStatus] = useState<CoPilotStatus>('INIT');
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<OutlineSection[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const warmed = useCallback(() => {
    setStatus((s) => (s === 'INIT' ? 'IDLE' : s));
  }, []);

  const generateOutline = useCallback(async (topic: string, targetAudience: string, difficultyLevel: string) => {
    if (!topic.trim()) return;
    setStatus('LOADING');
    setError(null);
    setSections([]);
    try {
      const streamed: OutlineSection[] = [];
      const meta = await readOutlineStream(topic.trim(), (section) => {
        streamed.push(section);
        setSections([...streamed]);
      });
      if (meta.jobId) setJobId(meta.jobId);
      setProgress(100);
      setStatus('SUCCESS');
    } catch {
      try {
        const r = await coPilotApi().outline({ topic: topic.trim(), targetAudience, difficultyLevel, numberOfSections: 5 });
        setJobId(r.jobId);
        setSections(r.sections);
        setProgress(100);
        setStatus('SUCCESS');
      } catch (e) {
        setStatus('ERROR');
        setError((e as Error).message);
      }
    }
  }, []);

  const pollJob = useCallback(async (id: string) => {
    for (let i = 0; i < 20; i++) {
      const j = await coPilotApi().job(id);
      setProgress(j.progressPercent);
      if (j.status === 'COMPLETED') return true;
      if (j.status === 'FAILED') throw new Error(j.errorMessage ?? 'transcribe failed');
      await new Promise((res) => setTimeout(res, 1500));
    }
    return false;
  }, []);

  return { status, error, sections, jobId, progress, warmed, generateOutline, pollJob, retry: () => setStatus('IDLE') };
}
