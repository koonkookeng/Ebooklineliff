// SSOT Phase 009 §6.1 — RAM-optimized predictive search bar (5 states, <30MB, tenant theming)
'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { useDebounce } from '../../hooks/use-debounce';

export interface PredictiveSuggestion {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string;
  productType: string;
  price: number;
  discountPrice: number | null;
  highlightSnippet?: string | null;
}

export type SearchUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface Props {
  liffReady?: boolean;
  initialQuery?: string;
  onSelect?: (item: PredictiveSuggestion) => void;
}

const MAX_SUGGESTIONS = 5; // RAM guard: max 5 rows in memory

export function PredictiveSearchBar({ liffReady = true, initialQuery = '', onSelect }: Props) {
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<PredictiveSuggestion[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [uiState, setUiState] = useState<SearchUiState>(liffReady ? 'IDLE' : 'LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounce(searchTerm, 150);

  useEffect(() => {
    if (!liffReady) {
      setUiState('LIFF_INIT');
      return;
    }
    try {
      const raw = localStorage.getItem('search:history');
      if (raw) setHistory((JSON.parse(raw) as string[]).slice(0, 8));
    } catch {
      // private-mode storage: stay functional without history
    }
  }, [liffReady]);

  useEffect(() => {
    if (!liffReady) return;
    const q = debouncedQuery.trim();
    if (!q) {
      abortRef.current?.abort();
      startTransition(() => {
        setSuggestions([]);
        setUiState('IDLE');
        setError(null);
      });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setUiState('LOADING');
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/search/predictive?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as PredictiveSuggestion[];
        startTransition(() => {
          setSuggestions(data.slice(0, MAX_SUGGESTIONS));
          setUiState('SUCCESS');
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        startTransition(() => {
          setSuggestions([]);
          setError('ไม่พบข้อมูลสินค้า');
          setUiState('ERROR');
        });
      }
    })();
    return () => ctrl.abort();
  }, [debouncedQuery, liffReady]);

  const pick = (item: PredictiveSuggestion): void => {
    try {
      const next = [item.title, ...history.filter((h) => h !== item.title)].slice(0, 8);
      setHistory(next);
      localStorage.setItem('search:history', JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
    if (onSelect) onSelect(item);
    else window.location.href = `/catalog/${item.slug}`;
  };

  const clearAll = (): void => {
    setSearchTerm('');
    setSuggestions([]);
    setError(null);
    setUiState('IDLE');
  };

  if (uiState === 'LIFF_INIT') {
    return (
      <div className="w-full max-w-md mx-auto" aria-busy="true">
        <div className="h-10 rounded-full bg-gray-100 animate-pulse border border-[var(--tenant-accent,#e5e7eb)]" />
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="relative flex items-center">
        <input
          type="text"
          role="searchbox"
          aria-label="ค้นหาสินค้า"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="ค้นหาหนังสือ คอร์สเรียน หรือสินค้า..."
          disabled={false}
          className="w-full px-4 py-2 text-sm border rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--tenant-primary,#00C300)] bg-[var(--tenant-search-bg,#ffffff)]"
        />
        {(uiState === 'LOADING' || isPending) && (
          <div
            aria-label="กำลังค้นหา"
            className="absolute right-3 w-4 h-4 border-2 border-t-transparent border-gray-500 rounded-full animate-spin"
          />
        )}
        {searchTerm && (
          <button
            type="button"
            aria-label="ล้างการค้นหา"
            onClick={clearAll}
            className="absolute right-3 text-xs text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}
      </div>

      {uiState === 'IDLE' && !searchTerm && history.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden">
          <p className="px-4 pt-2 text-[11px] text-gray-400">ค้นหาล่าสุด</p>
          <ul>
            {history.map((h) => (
              <li key={h}>
                <button
                  type="button"
                  onClick={() => setSearchTerm(h)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                >
                  {h}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {uiState === 'SUCCESS' && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-2 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden">
          {suggestions.map((item) => (
            <li
              key={item.id}
              onClick={() => pick(item)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.coverImageUrl}
                alt=""
                width={36}
                height={48}
                loading="lazy"
                className="object-cover rounded"
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium text-gray-900 truncate"
                  dangerouslySetInnerHTML={{
                    __html: item.highlightSnippet ?? item.title.replace(/</g, '&lt;'),
                  }}
                />
                <span className="inline-block px-2 py-0.5 text-[10px] bg-blue-50 text-blue-600 rounded">
                  {item.productType}
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-emerald-600">฿{item.price}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {uiState === 'ERROR' && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-lg shadow border border-gray-100 p-4 text-center">
          <p className="text-sm text-gray-600">{error ?? 'ไม่พบข้อมูลสินค้า'}</p>
          <button
            type="button"
            onClick={clearAll}
            className="mt-2 text-sm px-4 py-1.5 rounded-full border hover:bg-gray-50"
          >
            ล้างตัวกรอง
          </button>
        </div>
      )}
    </div>
  );
}

export default PredictiveSearchBar;
