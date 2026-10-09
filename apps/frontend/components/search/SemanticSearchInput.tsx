// SSOT Phase 091 BDD-1 — Semantic search input (dep-free)
// Canonical: apps/frontend/components/search/SemanticSearchInput.tsx
// - RISK_CALL: no shadcn/lucide (spec asks them) — native input + list keep
//   LIFF RAM <30MB (Gate 5). Badge shows similarity confidence.
// - Zero-dep (React only).
'use client';

import React, { useEffect } from 'react';
import { useSemanticSearch } from '../../hooks/useSemanticSearch';

export function SemanticSearchInput(props: { productIdFilter?: string; onSelect?: (productId: string) => void }) {
  const { status, error, items, tookMs, ready, search, retry } = useSemanticSearch();

  useEffect(() => {
    ready();
  }, [ready]);

  return (
    <div>
      <input
        type="search"
        placeholder="ค้นหาด้วยภาษาธรรมชาติ..."
        aria-label="Semantic search"
        onChange={(e) => search(e.target.value, props.productIdFilter)}
        maxLength={500}
      />
      {status === 'LIFF_INIT' && <p>กำลังเตรียมระบบค้นหา…</p>}
      {status === 'LOADING' && <p aria-busy="true">กำลังแปลงข้อความเป็น Vector & ค้นหา…</p>}
      {status === 'SUCCESS' && (
        <div>
          <p role="status">
            พบ {items.length} ผลลัพธ์{tookMs != null ? ` (${tookMs}ms)` : ''}
          </p>
          <ul>
            {items.map((it) => (
              <li key={`${it.sourceId}:${it.chunkIndex}`}>
                <button type="button" onClick={() => props.onSelect?.(it.productId)}>
                  {it.productTitle} — {Math.round(it.similarityScore * 100)}% Match
                  {it.pageNumber != null ? ` (บทที่ ${it.pageNumber})` : ''}
                </button>
                <p>{it.contentText.slice(0, 120)}…</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status === 'ERROR' && (
        <div>
          <p role="alert">{error ?? 'ไม่พบเนื้อหาที่เกี่ยวข้องกัน'}</p>
          <button type="button" onClick={retry}>
            ลองค้นแบบ Keyword ใหม่
          </button>
        </div>
      )}
    </div>
  );
}

export default SemanticSearchInput;
