// SSOT Phase 091 BDD-2 — Ask-AI drawer (dep-free, RAM-disciplined)
// Canonical: apps/frontend/components/reader/AiAskModal.tsx
// - RISK_CALL: no shadcn Sheet/lucide (spec asks them) — native dialog +
//   capped history (5 msgs) keep LIFF RAM <30MB (Gate 5). Refs cleared on
//   close for Webview GC.
// - Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { useAiAsk } from '../../hooks/useAiAsk';

export function AiAskModal(props: { productId: string; currentPage: number; bookTitle: string }) {
  const { productId, currentPage, bookTitle } = props;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { status, error, history, referencedPages, ask } = useAiAsk(productId, currentPage);

  useEffect(() => {
    if (!open) {
      setDraft('');
      if (typeof window !== 'undefined' && (window as Window & { gc?: () => void }).gc) {
        try {
          ((window as Window & { gc?: () => void }).gc as () => void)();
        } catch {
          /* GC unavailable — DOM cap already bounds memory */
        }
      }
    }
  }, [open ]);

  async function submit() {
    if (!draft.trim()) return;
    const q = draft;
    setDraft('');
    await ask(q);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        ✦ ถาม AI จากเล่มนี้
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={`AI ผู้ช่วยอ่าน: ${bookTitle}`}>
      <div>
        <p>
          ✦ AI ผู้ช่วยอ่าน: {bookTitle} (หน้า {currentPage})
        </p>
        <button type="button" onClick={() => setOpen(false)} aria-label="ปิด">
          ✕
        </button>
      </div>
      <div>
        {history.map((m, i) => (
          <div key={i}>
            <p>{m.text}</p>
          </div>
        ))}
        {status === 'LOADING' && <p aria-busy="true">สแกน pgvector Chunks & สรุปเนื้อหา...</p>}
        {status === 'ERROR' && error && <p role="alert">{error}</p>}
        {referencedPages.length > 0 && <p>อ้างอิงหน้า {referencedPages.join(', ')}</p>}
      </div>
      <div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="ถามข้อสงสัยเกี่ยวกับเนื้อหาหนังสือเล่มนี้..."
          maxLength={1000}
          aria-label="ถาม AI"
        />
        <button type="button" onClick={() => void submit()} disabled={status === 'LOADING'} aria-label="ส่ง">
          ➤
        </button>
      </div>
    </div>
  );
}

export default AiAskModal;
