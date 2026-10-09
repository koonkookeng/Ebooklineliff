// SSOT Phase 092 Task 5 — AI companion floating drawer (dep-free)
// Canonical: apps/frontend/components/ai/AiCompanionDrawer.tsx
// - RISK_CALL: no shadcn/lucide (spec asks them) — native drawer keeps
//   LIFF RAM <30MB (Gate 5). Quick prompts + SSE streaming + 5-msg DOM cap
//   via the companion hook; refs cleared on close for Webview GC.
// - Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { useAiCompanion } from '../../hooks/useAiCompanion';

const QUICK_PROMPTS = ['สรุปเนื้อหาหน้านี้ใน 3 ประโยค', 'มีศัพท์หรือแนวคิดสำคัญอะไรบ้าง', 'ออกควิซ 3 ข้อจากบทนี้'];

export function AiCompanionDrawer(props: {
  productId: string;
  currentPage?: number;
  currentLessonSec?: number;
  title: string;
}) {
  const { productId, currentPage, currentLessonSec, title } = props;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { status, error, messages, citations, warmed, ask, retry } = useAiCompanion(productId, currentPage);

  useEffect(() => {
    warmed();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(text: string) {
    if (!text.trim() || status === 'LOADING') return;
    setDraft('');
    await ask(text);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="เปิด AI ผู้ช่วย">
        ✦ ถาม AI
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={`AI ผู้ช่วย: ${title}`}>
      <div>
        <p>
          ✦ AI ผู้ช่วย{currentPage != null ? ` หน้า ${currentPage}` : currentLessonSec != null ? ` นาทีที่ ${currentLessonSec}วิ` : ''}: {title}
        </p>
        <button type="button" onClick={() => setOpen(false)} aria-label="ปิด">
          ✕
        </button>
      </div>
      {status === 'LIFF_INIT' && <p>กำลังโหลด Context หน้าปัจจุบัน…</p>}
      <div>
        {messages.map((m, i) => (
          <div key={i}>
            <p>{m.text || (status === 'LOADING' && i === messages.length - 1 ? 'กำลังประมวลผล...' : '')}</p>
          </div>
        ))}
        {status === 'LOADING' && messages.length === 0 && <p aria-busy="true">กำลังค้นหา Vector RAG…</p>}
        {status === 'ERROR' && (
          <div>
            <p role="alert">{error ?? 'AI ไม่สามารถประมวลผลได้ในขณะนี้'}</p>
            <button type="button" onClick={retry}>
              ลองใหม่
            </button>
          </div>
        )}
        {citations.length > 0 && (
          <p>
            อ้างอิง:{' '}
            {citations
              .map((c) => (c.pageNumber != null ? `หน้า ${c.pageNumber}` : c.timestampSec != null ? `${c.timestampSec}วิ` : ''))
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
      </div>
      <div>
        {QUICK_PROMPTS.map((p) => (
          <button key={p} type="button" onClick={() => void submit(p)} disabled={status === 'LOADING'}>
            {p}
          </button>
        ))}
      </div>
      <div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(draft);
          }}
          placeholder="ถาม AI เกี่ยวกับเนื้อหานี้..."
          maxLength={1000}
          aria-label="ถาม AI"
        />
        <button type="button" onClick={() => void submit(draft)} disabled={status === 'LOADING'} aria-label="ส่ง">
          ➤
        </button>
      </div>
    </div>
  );
}

export default AiCompanionDrawer;
