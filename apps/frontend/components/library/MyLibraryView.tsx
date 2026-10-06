// SSOT Phase 018 §6 — MyLibraryView (5-state, tabs + debounced search, tenant theme)
// Canonical: apps/frontend/components/library/MyLibraryView.tsx
// States: LIFF_INIT (splash skeleton) / LOADING (skeleton or inline spinner) /
// SUCCESS (grid, +offline badge when stale) / ERROR (retry). IDLE == SUCCESS settled.
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLibraryAssets,
  loadLibrarySnapshot,
  saveLibrarySnapshot,
  type AssetType,
  type MyLibraryPayload,
} from '../../lib/library';
import { LibraryAssetCard } from './LibraryAssetCard';

export type LibraryUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const TABS: Array<{ key: 'ALL' | AssetType; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'EBOOK', label: 'E-Books' },
  { key: 'ELEARNING_COURSE', label: 'คอร์สเรียน' },
  { key: 'HYBRID_BUNDLE', label: 'แพ็กเกจชุด' },
];

interface Props {
  accent?: string;
  tenantLogo?: string;
  gridClass?: string;
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-4" aria-busy="true">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-white rounded-2xl p-3 animate-pulse border border-slate-100">
          <div className="w-full aspect-[3/4] bg-slate-200 rounded-xl mb-3" />
          <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
          <div className="h-2 bg-slate-200 rounded w-full" />
        </div>
      ))}
    </div>
  );
}

export function MyLibraryView({ accent = '#059669', tenantLogo, gridClass }: Props) {
  const [uiState, setUiState] = useState<LibraryUiState>('LIFF_INIT');
  const [tab, setTab] = useState<'ALL' | AssetType>('ALL');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [payload, setPayload] = useState<MyLibraryPayload | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstLoad = useRef(true);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SUCCESS is the fresh-data flash; IDLE is the settled state (both render the grid).
  const settle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setUiState((s) => (s === 'SUCCESS' ? 'IDLE' : s)), 600);
  }, []);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async (assetType: 'ALL' | AssetType, searchQuery: string) => {
    setError(null);
    setStale(false);
    setUiState(firstLoad.current ? 'LIFF_INIT' : 'LOADING');
    try {
      const data = await fetchLibraryAssets({
        ...(assetType !== 'ALL' ? { assetType } : {}),
        ...(searchQuery ? { searchQuery } : {}),
      });
      setPayload(data);
      setUiState('SUCCESS');
      settle();
      firstLoad.current = false;
      void saveLibrarySnapshot(data);
    } catch (e) {
      const snapshot = await loadLibrarySnapshot();
      if (snapshot) {
        setPayload(snapshot);
        setStale(true);
        setUiState('SUCCESS');
        settle();
      } else {
        setError((e as Error).message || 'โหลดคลังไม่สำเร็จ');
        setUiState('ERROR');
      }
      firstLoad.current = false;
    }
  }, [settle]);

  useEffect(() => {
    void load(tab, debounced);
  }, [tab, debounced, load]);

  const retry = useCallback(() => {
    firstLoad.current = payload === null;
    void load(tab, debounced);
  }, [tab, debounced, payload, load]);

  return (
    <div
      className="min-h-screen bg-slate-50 p-4 pb-24"
      style={{ ['--primary-color' as string]: accent, ['--accent-color' as string]: accent }}
    >
      <div className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur-md pb-3 pt-2">
        <div className="flex items-center gap-2 mb-3">
          {tenantLogo && <img src={tenantLogo} alt="" className="h-6" />}
          <h1 className="text-xl font-bold text-slate-900">คลังของฉัน (My Library)</h1>
        </div>
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="ค้นหาหนังสือ หรือ คอร์สเรียน..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? 'text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'
              }`}
              style={tab === t.key ? { background: accent } : undefined}
            >
              {t.label}
            </button>
          ))}
          {uiState === 'LOADING' && payload && (
            <span className="px-3 py-1.5 text-xs text-slate-400 whitespace-nowrap" aria-live="polite">
              กำลังโหลด...
            </span>
          )}
        </div>
      </div>

      {stale && (
        <div className="mt-3 p-3 bg-amber-50 text-amber-700 text-xs rounded-lg" role="status">
          ออฟไลน์ — แสดงข้อมูลล่าสุดที่บันทึกไว้ในเครื่อง
        </div>
      )}

      {(uiState === 'LIFF_INIT' || (uiState === 'LOADING' && !payload)) && <SkeletonGrid />}

      {uiState === 'ERROR' && (
        <div className="text-center py-16">
          <p className="text-sm text-slate-500">{error ?? 'เกิดข้อผิดพลาด'}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 px-6 py-2.5 text-white text-sm font-bold rounded-xl"
            style={{ background: accent }}
          >
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {(uiState === 'SUCCESS' || uiState === 'IDLE' || (uiState === 'LOADING' && payload)) && payload && (
        payload.assets.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-slate-500">ไม่พบรายการดิจิทัลในคลังของคุณ</p>
          </div>
        ) : (
          <div className={gridClass ?? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-4'}>
            {payload.assets.map((a) => (
              <LibraryAssetCard key={a.id} asset={a} accent={accent} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default MyLibraryView;
