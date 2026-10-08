// SSOT Phase 059 §6.1 — ReaderGestureMapper (LIFF touch zones + swipe)
// Canonical: apps/frontend/components/reader/ReaderGestureMapper.tsx
// (legacy src/frontend/components/reader/ReaderGestureMapper.tsx)
// - Swipe engine: Δx≥50px (÷sensitivity), velocity>0.25px/ms, axis ratio 1.5,
//   window <400ms → NEXT/PREV_PAGE (<16ms intent dispatch, 60fps).
// - Tap zones: left 25% PREV / center 50% TOGGLE_HUD / right 25% NEXT, with
//   invertTapZones (left-handed) loaded fail-open from prefs.
// - Haptic tick on LIFF (navigator.vibrate, best-effort) + navigation beacons.
// - Unmount clears refs (no window listeners here → no leak). Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { isTap, swipeActionFor, tapZoneFor, type GestureType } from '@repo/shared';
import { useReaderNavigation } from '../../hooks/useReaderNavigation';
import { useReaderStore } from '../../stores/useReaderStore';
import { fetchReaderNavPreference, reportNavigationEvent } from '../../lib/reader/reader-navigation-client';

interface ReaderGestureMapperProps {
  productId: string;
  totalPages: number;
  children: React.ReactNode;
}

export const ReaderGestureMapper: React.FC<ReaderGestureMapperProps> = ({ productId, totalPages, children }) => {
  const { goToNextPage, goToPrevPage } = useReaderNavigation({ productId, totalPages, isLiffEnvironment: true });
  const [invertZones, setInvertZones] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);

  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchStartTimeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchReaderNavPreference()
      .then((p) => {
        if (cancelled || !p) return;
        setInvertZones(p.invertTapZones);
        setSensitivity(p.swipeSensitivity);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const buzz = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8);
    } catch {
      // haptics best-effort
    }
  };

  const dispatch = (kind: 'NEXT_PAGE' | 'PREV_PAGE' | 'TOGGLE_HUD', x: number, y: number, gesture: GestureType, velocity?: number) => {
    const from = useReaderStore.getState().currentPage;
    if (kind === 'NEXT_PAGE') goToNextPage();
    else if (kind === 'PREV_PAGE') goToPrevPage();
    else useReaderStore.toggleHud();
    buzz();
    reportNavigationEvent({
      productId,
      currentPage: from,
      action: kind,
      deviceType: 'TOUCH_SCREEN',
      gestureDetails: { gestureType: gesture, coordinateX: Math.round(x), coordinateY: Math.round(y), swipeVelocity: velocity },
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
      touchStartTimeRef.current = Date.now();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.changedTouches.length !== 1) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - touchStartXRef.current;
    const deltaY = endY - touchStartYRef.current;
    const deltaTime = Date.now() - touchStartTimeRef.current;

    // 1. Swipe engine (horizontal-dominant + velocity gate).
    const swipe = swipeActionFor({ deltaX, deltaY, deltaTimeMs: deltaTime, sensitivity });
    if (swipe) {
      dispatch(swipe, endX, endY, swipe === 'NEXT_PAGE' ? 'SWIPE_LEFT' : 'SWIPE_RIGHT', Math.abs(deltaX) / Math.max(1, deltaTime));
      return;
    }

    // 2. Zone tap engine (stationary taps only).
    if (isTap({ deltaX, deltaY, deltaTimeMs: deltaTime })) {
      const width = typeof window !== 'undefined' ? window.innerWidth : 0;
      const zone = tapZoneFor(touchStartXRef.current, width, invertZones);
      if (zone === 'LEFT') dispatch('PREV_PAGE', touchStartXRef.current, touchStartYRef.current, 'TAP_LEFT');
      else if (zone === 'RIGHT') dispatch('NEXT_PAGE', touchStartXRef.current, touchStartYRef.current, 'TAP_RIGHT');
      else dispatch('TOGGLE_HUD', touchStartXRef.current, touchStartYRef.current, 'TAP_CENTER');
    }
  };

  return (
    <div className="relative h-full w-full select-none touch-pan-y" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Invisible touch-zone overlay indicator */}
      <div className="pointer-events-none absolute inset-0 z-10 grid grid-cols-4 opacity-0 transition-opacity active:opacity-10">
        <div className="border-r border-blue-400 bg-blue-500/20" />
        <div className="col-span-2 bg-green-500/20" />
        <div className="border-l border-blue-400 bg-blue-500/20" />
      </div>

      {children}
    </div>
  );
};

export default ReaderGestureMapper;
