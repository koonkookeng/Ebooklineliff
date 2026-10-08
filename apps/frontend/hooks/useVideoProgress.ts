// SSOT Phase 054 Task 5 — useVideoProgress (throttled 5s sync hook)
// Canonical: apps/frontend/hooks/useVideoProgress.ts
// (legacy src/frontend/hooks/useVideoProgress.ts)
// - Drives the §1.3 Scenario-4 cadence: the player reports timeupdate;
//   this hook dedupes identical seconds + enforces a ≥4s floor between
//   posts, then POSTs via the shared lesson-stream-client transport
//   (server upserts Redis + PostgreSQL, Phase 045/046 convention).
// - Completion derives from the shared 90% rule unless explicitly flagged.
// - RAM-safe: no retained timers (caller drives cadence), no buffering.
// - Zero new deps.
'use client';

import { useCallback, useRef, useState } from 'react';
import { RESUME_SYNC_EVERY_SEC, isLessonCompleted } from '@repo/shared';
import { fetchLessonState, reportLessonHeartbeat } from '../lib/stream/lesson-stream-client';

interface UseVideoProgressConfig {
  lessonId: string;
  durationSec: number;
}

const MIN_POST_GAP_MS = (RESUME_SYNC_EVERY_SEC - 1) * 1000;

export function useVideoProgress({ lessonId, durationSec }: UseVideoProgressConfig) {
  const lastSentRef = useRef<{ sec: number; at: number }>({ sec: -1, at: 0 });
  const [lastSyncedSec, setLastSyncedSec] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncProgress = useCallback(
    async (watchedSec: number, isCompleted = false): Promise<boolean> => {
      const sec = Math.max(0, Math.floor(watchedSec));
      const now = Date.now();
      if (sec === lastSentRef.current.sec) return true; // dedupe identical seconds
      if (now - lastSentRef.current.at < MIN_POST_GAP_MS) return true; // throttle floor
      lastSentRef.current = { sec, at: now };
      try {
        await reportLessonHeartbeat({
          lessonId,
          watchedSec: sec,
          durationSec: Math.max(1, Math.floor(durationSec)),
          isCompleted: isLessonCompleted(sec, durationSec, isCompleted),
        });
        setLastSyncedSec(sec);
        setSyncError(null);
        return true;
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'sync failed');
        return false;
      }
    },
    [lessonId, durationSec],
  );

  const loadSavedState = useCallback(async (): Promise<number> => {
    const state = await fetchLessonState(lessonId);
    return state.lastWatchedSec;
  }, [lessonId]);

  return { syncProgress, loadSavedState, lastSyncedSec, syncError };
}

export default useVideoProgress;
