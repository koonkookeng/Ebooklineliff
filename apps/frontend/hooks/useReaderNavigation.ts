// SSOT Phase 059 §6.1 — useReaderNavigation (keyboard + programmatic paging)
// Canonical: apps/frontend/hooks/useReaderNavigation.ts
// (legacy src/frontend/hooks/useReaderNavigation.ts)
// - goToNextPage/goToPrevPage/goToPage: clamped against totalPages so the
//   sliding-window engine only fetches N+1 / purges N-2 (RAM <30MB).
// - Web keyboard engine: Space/Arrows/PageUp-PageDown/Home/End/KeyM/KeyF
//   with input-focus guard (§2.1 a11y) + 200ms throttle (LOADING state).
// - Emits best-effort navigation beacons (§7.1) and cleans up listeners on
//   unmount (memory-leak safeguard, §10). Zero new deps.
'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  NAV_KEY_THROTTLE_MS,
  clampPage,
  isTypingTarget,
  keyIntentFor,
} from '@repo/shared';
import { useReaderStore } from '../stores/useReaderStore';
import { reportNavigationEvent } from '../lib/reader/reader-navigation-client';

interface UseReaderNavigationProps {
  productId: string;
  totalPages: number;
  isLiffEnvironment: boolean;
}

export const useReaderNavigation = ({ productId, totalPages, isLiffEnvironment }: UseReaderNavigationProps) => {
  const lastKeyAtRef = useRef(0);
  const totalRef = useRef(totalPages);
  totalRef.current = totalPages;

  const goToPage = useCallback(
    (page: number, deviceType: 'TOUCH_SCREEN' | 'KEYBOARD' | 'MOUSE_CLICK' = 'KEYBOARD') => {
      const total = totalRef.current;
      const from = useReaderStore.getState().currentPage;
      // Unknown catalogue totals arrive as the 1-page placeholder: allow
      // single-step forward optimistically (canvas 404 → ERROR retry), pin
      // the lower bound at 1, and never skip ahead into the unknown.
      let next = total > 1 ? clampPage(page, total) : Math.max(1, page);
      if (total <= 1 && next > from + 1) next = from + 1;
      if (next === from) return;
      // Exact write: catalogue totals may still be the 1-page placeholder.
      useReaderStore.setCurrentPageExact(next);
      reportNavigationEvent({
        productId,
        currentPage: from,
        action: next > from ? 'NEXT_PAGE' : 'PREV_PAGE',
        deviceType,
      });
    },
    [productId],
  );

  const goToNextPage = useCallback(() => {
    goToPage(useReaderStore.getState().currentPage + 1, isLiffEnvironment ? 'TOUCH_SCREEN' : 'KEYBOARD');
  }, [goToPage, isLiffEnvironment]);

  const goToPrevPage = useCallback(() => {
    goToPage(useReaderStore.getState().currentPage - 1, isLiffEnvironment ? 'TOUCH_SCREEN' : 'KEYBOARD');
  }, [goToPage, isLiffEnvironment]);

  const toggleHud = useCallback(() => {
    useReaderStore.toggleHud();
    reportNavigationEvent({
      productId,
      currentPage: useReaderStore.getState().currentPage,
      action: 'TOGGLE_HUD',
      deviceType: isLiffEnvironment ? 'TOUCH_SCREEN' : 'KEYBOARD',
    });
  }, [productId, isLiffEnvironment]);

  // Keyboard engine (Web Browser; LIFF keeps touch only to save cycles).
  useEffect(() => {
    if (isLiffEnvironment) return;
    let prefsEnabled = true;
    let cancelled = false;
    void import('../lib/reader/reader-navigation-client').then((m) =>
      m.fetchReaderNavPreference().then((p) => {
        if (!cancelled && p) prefsEnabled = p.enableKeyboardShortcuts;
      }),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!prefsEnabled) return;
      if (isTypingTarget(document.activeElement)) return;
      const intent = keyIntentFor(event.code, event.shiftKey);
      if (!intent) return;
      const now = Date.now();
      if (now - lastKeyAtRef.current < NAV_KEY_THROTTLE_MS) {
        event.preventDefault();
        return;
      }
      lastKeyAtRef.current = now;
      const total = totalRef.current;
      const current = useReaderStore.getState().currentPage;
      switch (intent) {
        case 'NEXT_PAGE':
          event.preventDefault();
          goToPage(current + 1, 'KEYBOARD');
          break;
        case 'PREV_PAGE':
          event.preventDefault();
          goToPage(current - 1, 'KEYBOARD');
          break;
        case 'FIRST_PAGE':
          event.preventDefault();
          goToPage(1, 'KEYBOARD');
          break;
        case 'LAST_PAGE':
          event.preventDefault();
          if (total > 1) goToPage(total, 'KEYBOARD');
          break;
        case 'TOGGLE_HUD':
          event.preventDefault();
          toggleHud();
          break;
        case 'TOGGLE_FULLSCREEN':
          event.preventDefault();
          if (typeof document !== 'undefined') {
            try {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            } catch {
              // fullscreen is best-effort inside webviews
            }
          }
          reportNavigationEvent({ productId, currentPage: current, action: 'TOGGLE_FULLSCREEN', deviceType: 'KEYBOARD' });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [goToPage, toggleHud, productId, isLiffEnvironment]);

  return { goToNextPage, goToPrevPage, goToPage, toggleHud };
};

export default useReaderNavigation;
