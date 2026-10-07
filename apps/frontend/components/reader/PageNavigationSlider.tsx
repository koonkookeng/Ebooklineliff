// SSOT Phase 041 Task 5 — PageNavigationSlider (debounced scrub, §6.3)
// Canonical: apps/frontend/components/reader/PageNavigationSlider.tsx
// (legacy src/frontend/components/reader/PageNavigationSlider.tsx)
// - Instant 60FPS thumb feedback (local state) + 300ms debounced commit so the
//   sliding-window fetcher only loads the settled [N-1,N,N+1] (BDD scrub).
// - Zero new deps.
'use client';

import { useEffect, useRef, useState } from 'react';
import { PAGE_SLIDER_DEBOUNCE_MS } from '@repo/shared';
import { useReaderStore } from '../../stores/useReaderStore';

interface PageNavigationSliderProps {
  productId: string;
}

export function PageNavigationSlider({ productId }: PageNavigationSliderProps) {
  void productId;
  const currentPage = useReaderStore((s) => s.currentPage);
  const totalPages = useReaderStore((s) => s.totalPages);
  const [sliderValue, setSliderValue] = useState<number>(currentPage);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSliderValue(currentPage);
  }, [currentPage]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newPage = parseInt(e.target.value, 10);
    if (!Number.isInteger(newPage)) return;
    setSliderValue(newPage);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (newPage !== useReaderStore.getState().currentPage) {
        useReaderStore.setCurrentPage(newPage);
      }
    }, PAGE_SLIDER_DEBOUNCE_MS);
  };

  const handleSliderCommit = (): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (sliderValue !== useReaderStore.getState().currentPage) {
      useReaderStore.setCurrentPage(sliderValue);
    }
  };

  const percentage = Math.round((sliderValue / Math.max(totalPages, 1)) * 100);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col space-y-2">
      <div className="flex justify-between px-1 text-xs font-medium text-muted-foreground">
        <span>
          หน้า {sliderValue} / {totalPages}
        </span>
        <span>{percentage}% อ่านแล้ว</span>
      </div>
      <div className="relative flex items-center">
        <input
          type="range"
          min={1}
          max={Math.max(totalPages, 1)}
          value={sliderValue}
          onChange={handleSliderChange}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary focus:outline-none"
          aria-label={`Go to page (current ${currentPage} of ${totalPages})`}
        />
      </div>
    </div>
  );
}

export default PageNavigationSlider;
