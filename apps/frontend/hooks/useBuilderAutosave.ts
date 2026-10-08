// SSOT Phase 074 BDD-1 — Draft autosave hook (5s debounce + restore)
// Canonical: apps/frontend/hooks/useBuilderAutosave.ts
// - Watches wizard values; saves stepIndex + payload every 5s when dirty
//   (background, non-blocking); restores latest draft on mount (<=100ms
//   hydration target, §10). Exposes saved-at stamp for the step indicator.
// - Zero-dep beyond the builder client.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BUILDER_AUTOSAVE_MS } from '@repo/shared';
import { builderApi } from '../lib/builder/builder-client';

export function useBuilderAutosave(
  slug: string,
  step: number,
  values: Record<string, unknown>,
  onRestored: (payload: Record<string, unknown>, stepIndex: number, draftId: string) => void,
) {
  const [draftId, setDraftId] = useState<string | undefined>(
    typeof values['draftId'] === 'string' ? (values['draftId'] as string) : undefined,
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<string>('');
  const mounted = useRef(false);

  // Restore latest draft once (draftId from URL).
  useEffect(() => {
    if (mounted.current || typeof window === 'undefined') return;
    mounted.current = true;
    const id = new URLSearchParams(window.location.search).get('draftId');
    if (!id) return;
    builderApi(slug)
      .loadDraft(id)
      .then((snap) => {
        if (!snap) return;
        setDraftId(id);
        onRestored({ ...(snap.payload as Record<string, unknown>), draftId: id }, snap.stepIndex, id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const save = useCallback(
    async (nextValues: Record<string, unknown>, nextStep: number) => {
      setSaving(true);
      try {
        const res = await builderApi(slug).saveDraft({
          ...nextValues,
          ...(draftId ? { draftId } : {}),
          stepIndex: nextStep,
        });
        setDraftId(res.draftId);
        setSavedAt(new Date().toISOString());
      } catch {
        // Background save never blocks the wizard (ERROR surfaces on publish).
      } finally {
        setSaving(false);
      }
    },
    [slug, draftId],
  );

  // Debounced autosave on change.
  useEffect(() => {
    const snapshot = JSON.stringify([step, values]);
    if (snapshot === last.current) return;
    last.current = snapshot;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(values, step), BUILDER_AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [step, values, save]);

  return { draftId, savedAt, saving, saveNow: save };
}
