// SSOT Phase 009 §6.1 — Dynamic faceted filter drawer (URL-synced, no full re-render)
// Canonical: apps/frontend/components/catalog/faceted-filter-drawer.tsx
'use client';

import React, { useCallback } from 'react';

export interface CatalogFilter {
  productTypes: string[];
  minPrice?: number;
  maxPrice?: number;
  ratingMin?: number;
  sortBy: string;
  inStockOnly: boolean;
}

interface Props {
  open: boolean;
  filter: CatalogFilter;
  facets: Array<{ facetName: string; value: string; count: number }>;
  onChange: (next: CatalogFilter) => void;
  onClose: () => void;
  onClear: () => void;
}

export const PRODUCT_TYPE_OPTIONS = [
  'PHYSICAL_BOOK',
  'EBOOK',
  'ELEARNING_COURSE',
  'LIVE_CLASS',
  'HYBRID_BUNDLE',
] as const;

export const SORT_OPTIONS = [
  { value: 'RELEVANCE', label: 'เกี่ยวข้องที่สุด' },
  { value: 'NEWEST', label: 'ใหม่ล่าสุด' },
  { value: 'PRICE_ASC', label: 'ราคาต่ำ → สูง' },
  { value: 'PRICE_DESC', label: 'ราคาสูง → ต่ำ' },
  { value: 'RATING', label: 'คะแนนสูงสุด' },
  { value: 'POPULARITY', label: 'ยอดนิยม' },
] as const;

function facetCount(facets: Props['facets'], name: string, value: string): number | null {
  const f = facets.find((x) => x.facetName === name && x.value === value);
  return f ? f.count : null;
}

export function FacetedFilterDrawer({ open, filter, facets, onChange, onClose, onClear }: Props) {
  const toggleType = useCallback(
    (t: string) => {
      const has = filter.productTypes.includes(t);
      onChange({
        ...filter,
        productTypes: has ? filter.productTypes.filter((x) => x !== t) : [...filter.productTypes, t],
      });
    },
    [filter, onChange],
  );

  if (!open) return null;
  return (
    <div role="dialog" aria-label="ตัวกรองสินค้า" className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-[320px] max-w-[85vw] bg-white shadow-xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">ตัวกรอง</h2>
          <button type="button" onClick={onClear} className="text-xs text-gray-500 hover:text-gray-800">
            ล้างตัวกรอง
          </button>
        </div>

        <section className="mb-4">
          <p className="text-xs text-gray-500 mb-2">ประเภทสินค้า</p>
          <div className="flex flex-wrap gap-2">
            {PRODUCT_TYPE_OPTIONS.map((t) => {
              const active = filter.productTypes.includes(t);
              const count = facetCount(facets, 'productType', t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleType(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${
                    active ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200'
                  }`}
                >
                  {t}
                  {count !== null && <span className="ml-1 opacity-60">({count})</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            ราคาต่ำสุด
            <input
              type="number"
              min={0}
              value={filter.minPrice ?? ''}
              onChange={(e) =>
                onChange({ ...filter, minPrice: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            ราคาสูงสุด
            <input
              type="number"
              min={0}
              value={filter.maxPrice ?? ''}
              onChange={(e) =>
                onChange({ ...filter, maxPrice: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            />
          </label>
        </section>

        <section className="mb-4">
          <p className="text-xs text-gray-500 mb-2">คะแนนขั้นต่ำ</p>
          <div className="flex gap-2">
            {[0, 3, 4, 4.5].map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={filter.ratingMin === r}
                onClick={() => onChange({ ...filter, ratingMin: r === 0 ? undefined : r })}
                className={`text-xs px-3 py-1.5 rounded-full border ${
                  (filter.ratingMin ?? 0) === r ? 'bg-black text-white border-black' : 'border-gray-200'
                }`}
              >
                {r === 0 ? 'ทั้งหมด' : `≥ ${r}★`}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-4">
          <label className="text-xs text-gray-500">
            เรียงตาม
            <select
              value={filter.sortBy}
              onChange={(e) => onChange({ ...filter, sortBy: e.target.value })}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filter.inStockOnly}
              onChange={(e) => onChange({ ...filter, inStockOnly: e.target.checked })}
            />
            เฉพาะสินค้าพร้อมขาย
          </label>
        </section>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-full text-sm font-bold text-white bg-[var(--tenant-primary,#00C300)]"
        >
          แสดงผลลัพธ์
        </button>
      </aside>
    </div>
  );
}

export default FacetedFilterDrawer;
