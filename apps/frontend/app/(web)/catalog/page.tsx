// SSOT Phase 009 §6.1 — Web catalog discovery (mirrors LIFF, wider grid; shared search lib)
'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { PredictiveSearchBar } from '../../../components/search/predictive-search-bar';
import { FacetedFilterDrawer, type CatalogFilter } from '../../../components/catalog/faceted-filter-drawer';
import { fetchCatalogSearch, type FacetCount, type SearchCard } from '../../../lib/product-search';

const DEFAULT_FILTER: CatalogFilter = { productTypes: [], sortBy: 'RELEVANCE', inStockOnly: false };

export default function WebCatalogPage() {
  const [filter, setFilter] = useState<CatalogFilter>(DEFAULT_FILTER);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchCard[]>([]);
  const [facets, setFacets] = useState<FacetCount[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const run = useCallback(async (q: string, f: CatalogFilter) => {
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
        limit: 24,
      });
      startTransition(() => {
        setItems(res.items);
        setFacets(res.facets);
        setFailed(false);
      });
    } catch {
      startTransition(() => {
        setItems([]);
        setFailed(true);
      });
    }
  }, []);

  useEffect(() => {
    void run(query, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter.productTypes.join(','), filter.sortBy, filter.minPrice, filter.maxPrice, filter.ratingMin, filter.inStockOnly]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <PredictiveSearchBar liffReady initialQuery="" />
        </div>
        <button type="button" onClick={() => setDrawer(true)} className="text-sm px-4 py-2 rounded-full border">
          ตัวกรอง{filter.productTypes.length > 0 && ` (${filter.productTypes.length})`}
        </button>
      </div>
      <input
        aria-label="ค้นหาในแค็ตตาล็อก"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ค้นหาในแค็ตตาล็อก..."
        className="mt-3 w-full max-w-md border rounded-full px-4 py-2 text-sm"
      />
      {failed ? (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">ไม่พบข้อมูลสินค้า</p>
          <button type="button" onClick={() => { setFilter(DEFAULT_FILTER); setQuery(''); }} className="mt-2 text-sm px-4 py-1.5 rounded-full border">
            ล้างตัวกรอง
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          {items.map((it) => (
            <a key={it.id} href={`/catalog/${it.slug}`} className="border rounded-lg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.coverImageUrl} alt="" loading="lazy" className="h-44 w-full object-cover" />
              <div className="p-2">
                <p className="text-xs font-medium truncate">{it.title}</p>
                <p className="text-sm font-bold text-emerald-600">฿{it.price}</p>
              </div>
            </a>
          ))}
        </div>
      )}
      <FacetedFilterDrawer open={drawer} filter={filter} facets={facets} onChange={setFilter} onClose={() => setDrawer(false)} onClear={() => setFilter(DEFAULT_FILTER)} />
    </main>
  );
}
