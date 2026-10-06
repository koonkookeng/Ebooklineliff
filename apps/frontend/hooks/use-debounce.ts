// SSOT Phase 009 §6.1 — Debounce hook (150ms predictive threshold, zero deps, LIFF-safe)
'use client';

import { useEffect, useState } from 'react';

/** Return a debounced copy of `value` updated only after `delayMs` of stability. */
export function useDebounce<T>(value: T, delayMs = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), Math.max(0, delayMs));
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
