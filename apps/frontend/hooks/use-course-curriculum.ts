// SSOT Phase 037 Task 7/§6 — useCourseCurriculum (lightweight tree hook)
// Canonical: apps/frontend/hooks/use-course-curriculum.ts
// - Fetches the stripped curriculum tree (id/title/order/media only) via the
//   structure proxy; sorts defensively client-side (BDD Scenario 2 — order is
//   guaranteed server-side, re-asserted here for render safety).
// - 5 states: LIFF_INIT → IDLE → LOADING → SUCCESS / ERROR (retryable).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { byLessonOrder, type CourseSection, type EbookChapter } from '@repo/shared';

export type CurriculumStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface CurriculumTree {
  productId: string;
  totalHours: number;
  sections: CourseSection[];
}

/** Order-guaranteed curriculum (defensive client re-sort, BDD Scenario 2). */
export function sortCurriculum(sections: CourseSection[]): CourseSection[] {
  return [...sections]
    .sort((a, b) => a.sectionOrder - b.sectionOrder)
    .map((s) => ({ ...s, lessons: [...(s.lessons ?? [])].sort(byLessonOrder) }));
}

export function useCourseCurriculum(productId: string | null) {
  const [status, setStatus] = useState<CurriculumStatus>('LIFF_INIT');
  const [tree, setTree] = useState<CurriculumTree | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) {
      setStatus('IDLE');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      const res = await fetch(`/api/v1/catalog/structure/course?productId=${encodeURIComponent(productId)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`curriculum ${res.status}`);
      const data = (await res.json()) as CurriculumTree;
      setTree({ productId: data.productId ?? productId, totalHours: data.totalHours ?? 0, sections: sortCurriculum(data.sections ?? []) });
      setStatus('SUCCESS');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
      setStatus('ERROR');
    }
  }, [productId]);

  useEffect(() => {
    setStatus(productId ? 'IDLE' : 'LIFF_INIT');
    void load();
  }, [productId, load]);

  return { status, tree, error, reload: load };
}

/** Lightweight TOC list for the LIFF reader drawer (BDD Scenario 1). */
export function useEbookToc(productId: string | null) {
  const [status, setStatus] = useState<CurriculumStatus>('LIFF_INIT');
  const [chapters, setChapters] = useState<EbookChapter[]>([]);

  useEffect(() => {
    if (!productId) {
      setStatus('IDLE');
      return;
    }
    let cancelled = false;
    setStatus('LOADING');
    void (async () => {
      try {
        const res = await fetch(`/api/v1/catalog/structure/ebook?productId=${encodeURIComponent(productId)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`toc ${res.status}`);
        const data = (await res.json()) as EbookChapter[];
        if (cancelled) return;
        setChapters([...data].sort((a, b) => a.chapterIndex - b.chapterIndex));
        setStatus('SUCCESS');
      } catch {
        if (!cancelled) setStatus('ERROR');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return { status, chapters };
}
