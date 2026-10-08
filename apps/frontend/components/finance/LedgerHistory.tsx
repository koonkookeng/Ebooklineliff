// SSOT Phase 081 §6 — Ledger statement history (paginated, dep-free)
// Canonical: apps/frontend/components/finance/LedgerHistory.tsx
// - Paginated double-entry history with running balances; zero-dep list
//   (no chart lib — lazy numbers keep LIFF RAM <30MB).
// - Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { financeApi, type LedgerStatementItem } from '../../lib/finance/finance-client';

export function LedgerHistory({ slug }: { slug: string }) {
  const [items, setItems] = useState<LedgerStatementItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const LIMIT = 20;

  useEffect(() => {
    let cancelled = false;
    void financeApi(slug)
      .statements(LIMIT, offset)
      .then((page) => {
        if (cancelled) return;
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setHasMore(page.hasMore);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, offset]);

  return (
    <section>
      <h2>ประวัติรายการ (Immutable Ledger)</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <span>{i.description.slice(0, 48)}</span>
            {i.creditAmount ? <span>+{i.creditAmount}</span> : null}
            {i.debitAmount ? <span>-{i.debitAmount}</span> : null}
            <span>คงเหลือ {i.runningBalance}</span>
          </li>
        ))}
        {items.length === 0 && !error && <li>ยังไม่มีรายการ</li>}
      </ul>
      {hasMore && (
        <button type="button" onClick={() => setOffset((o) => o + LIMIT)}>
          โหลดเพิ่มเติม
        </button>
      )}
    </section>
  );
}
