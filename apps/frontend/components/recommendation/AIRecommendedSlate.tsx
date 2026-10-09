// SSOT Phase 104 Task 7 — AI recommendation slate (virtualized rail, <15MB RAM)
// Canonical: apps/frontend/components/recommendation/AIRecommendedSlate.tsx
// - 5-state machine (LIFF_INIT → IDLE → LOADING shimmer → SUCCESS rail /
//   ERROR bestseller fallback). Render cap 6, snap rail, <img> covers.
// - Zero-dep (React only — no image optimizer, no icon lib in LIFF).
'use client';

import React from 'react';
import { useRecommendations } from '../../hooks/useRecommendations';
import type { RecItem } from '../../lib/recommendation/recommendation-client';

function MatchBadge({ score }: { score: number }) {
  return (
    <span className="absolute top-1 right-1 bg-black/70 text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
      {score}% Match
    </span>
  );
}

function RecCard({ item, onOpen }: { item: RecItem; onOpen: (item: RecItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="min-w-[160px] max-w-[160px] snap-start text-left bg-slate-900 border border-slate-800 rounded-xl p-2 flex flex-col"
    >
      <span className="relative block w-full h-40 rounded-lg overflow-hidden mb-2 bg-slate-800">
        {item.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverImageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
        ) : null}
        <MatchBadge score={item.matchScore} />
      </span>
      <span className="text-[11px] text-amber-500 font-medium mb-1 truncate">{item.productType}</span>
      <span className="text-xs font-semibold line-clamp-2 text-slate-100 mb-1">{item.title}</span>
      <span className="text-[11px] text-slate-400 line-clamp-1 mb-1">{item.reasonText}</span>
      <span className="mt-auto pt-1 flex items-baseline gap-1">
        <span className="text-sm font-bold text-emerald-400">฿{item.price}</span>
        {item.discountPrice != null && (
          <span className="text-[10px] text-slate-500 line-through">฿{item.discountPrice}</span>
        )}
      </span>
    </button>
  );
}

export function AIRecommendedSlate({ tenant = 'default', limit = 6 }: { tenant?: string; limit?: number }) {
  const { status, items, slateTitle, error, track, feedback, retry } = useRecommendations(tenant, limit);

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div className="w-full p-4 grid grid-cols-2 gap-3 animate-pulse" aria-busy="true">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-48 bg-slate-800 rounded-xl" />
        ))}
      </div>
    );
  }

  if (status === 'ERROR' && items.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-400 text-sm">{error ?? 'โหลดคำแนะนำไม่สำเร็จ'}</p>
        <button type="button" onClick={retry} className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
          ลองใหม่
        </button>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="w-full my-6 px-4" style={{ ['--rec-primary' as string]: 'var(--primary-color, #6366f1)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6L12 2z" fill="#f59e0b" />
          </svg>
          <h2 className="text-lg font-bold text-slate-100">{slateTitle}</h2>
        </div>
        <span className="text-xs text-amber-500 font-semibold bg-amber-500/10 px-2 py-1 rounded-full">Personalized</span>
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2">
        {items.map((item) => (
          <RecCard
            key={item.productId}
            item={item}
            onOpen={(it) => {
              track({ productId: it.productId, eventType: 'ITEM_VIEW' });
              feedback(it.productId, 'click');
            }}
          />
        ))}
      </div>
    </section>
  );
}

export default AIRecommendedSlate;
