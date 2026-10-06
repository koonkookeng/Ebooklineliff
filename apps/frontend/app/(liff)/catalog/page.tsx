// SSOT Phase 009 §6.1 — LIFF catalog discovery (predictive + faceted filter, 5 states, <30MB)
'use client';

import React, { Suspense, useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PredictiveSearchBar } from '../../../components/search/predictive-search-bar';
import { FacetedFilterDrawer, type CatalogFilter } from '../../../components/catalog/faceted-filter-drawer';
import { fetchCatalogSearch, type FacetCount, type SearchCard } from '../../../lib/product-search';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const DEFAULT_FILTER: CatalogFilter = {
  productTypes: [],
  sortBy: 'RELEVANCE',
  inStockOnly: false,
};

function LiffCatalogInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [filter, setFilter] = useState<CatalogFilter>(DEFAULT_FILTER);
  const [query, setQuery] = useState(params.get('query') ?? '');
  const [items, setItems] = useState<SearchCard[]>([]);
  const [facets, setFacets] = useState<FacetCount[]>([]);
  const [total, setTotal] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [uiState, setUiState] = useState<UiState>('LIFF_INIT');
  const [, startTransition] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => setUiState('IDLE'), 300);
    return () => clearTimeout(t);
  }, []);

  const runSearch = useCallback(async (q: string, f: CatalogFilter) => {
    setUiState('LOADING');
    try {
      const res = await fetchCatalogSearch({
        query: q || undefined,
        productTypes: f.productTypes,
        minPrice: f.minPrice,
        maxPrice: f.maxPrice,
        ratingMin: f.ratingMin,
        sortBy: f.sortBy,
        inStockOnly: f.inStockOnly,
        page: 1,
        limit: 20,
      });
      startTransition(() => {
        setItems(res.items);
        setFacets(res.facets);
        setTotal(res.totalCount);
        setUiState('SUCCESS');
      });
    } catch {
      startTransition(() => {
        setItems([]);
        setUiState('ERROR');
      });
    }
  }, []);

  useEffect(() => {
    if (uiState === 'LIFF_INIT') return;
    const qs = new URLSearchParams();
    if (query) qs.set('query', query);
    if (filter.productTypes.length) qs.set('productTypes', filter.productTypes.join(','));
    if (filter.sortBy !== 'RELEVANCE') qs.set('sortBy', filter.sortBy);
    router.replace(`?${qs.toString()}`, { scroll: false });
    void runSearch(query, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter.productTypes.join(','), filter.sortBy, filter.minPrice, filter.maxPrice, filter.ratingMin, filter.inStockOnly]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <PredictiveSearchBar liffReady={uiState !== 'LIFF_INIT'} initialQuery={query} />
      <div className="mt-3 flex gap-2">
        <input
          aria-label="ค้นหาในแค็ตตาล็อก"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาในแค็ตตาล็อก..."
          className="flex-1 border rounded-full px-4 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="text-sm px-4 py-2 rounded-full border"
          aria-label="เปิดตัวกรอง"
        >
          ตัวกรอง{filter.productTypes.length > 0 && ` (${filter.productTypes.length})`}
        </button>
      </div>

      {uiState === 'LOADING' && (
        <div className="mt-4 grid grid-cols-2 gap-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {uiState === 'SUCCESS' && (
        <>
          <p className="mt-3 text-xs text-gray-500">พบ {total} รายการ</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {items.map((it) => (
              <a key={it.id} href={`/catalog/${it.slug}`} className="border rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.coverImageUrl} alt="" loading="lazy" className="h-36 w-full object-cover" />
                <div className="p-2">
                  <p className="text-xs font-medium truncate">{it.title}</p>
                  <p className="text-sm font-bold text-emerald-600">฿{it.price}</p>
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      {uiState === 'ERROR' && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">ไม่พบข้อมูลสินค้า</p>
          <button
            type="button"
            onClick={() => {
              setFilter(DEFAULT_FILTER);
              setQuery('');
            }}
            className="mt-2 text-sm px-4 py-1.5 rounded-full border"
          >
            ล้างตัวกรอง
          </button>
        </div>
      )}

      <FacetedFilterDrawer
        open={drawer}
        filter={filter}
        facets={facets}
        onChange={setFilter}
        onClose={() => setDrawer(false)}
        onClear={() => setFilter(DEFAULT_FILTER)}
      />
    </main>
  );
}

export default function LiffCatalogPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-4 py-4"><div className="h-10 rounded-full bg-gray-100 animate-pulse" /></main>}>
      <LiffCatalogInner />
    </Suspense>
  );
}
