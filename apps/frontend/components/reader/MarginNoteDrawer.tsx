// SSOT Phase 095 Task 6 — Margin note drawer (create/list/like + Flex share)
// Canonical: apps/frontend/components/reader/MarginNoteDrawer.tsx
// - Creates STUDY_GROUP/PRIVATE/PUBLIC notes, likes pins, shares via
//   window.liff with clipboard fallback (026/079/080/089/090 precedent).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { socialApi, type PageNote } from '../../lib/social/social-client';

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { liff?: LiffGlobal }).liff ?? null;
}

const VISIBILITIES = ['PRIVATE', 'STUDY_GROUP', 'PUBLIC'] as const;

export function MarginNoteDrawer(props: {
  ebookId: string;
  pageNumber: number;
  notes: PageNote[];
  selectedId: string | null;
  onCreated: () => void;
}) {
  const { ebookId, pageNumber, notes, selectedId, onCreated } = props;
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<(typeof VISIBILITIES)[number]>('PUBLIC');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function create() {
    if (busy || !content.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await socialApi().create({
        ebookId,
        pageNumber,
        positionX: 50,
        positionY: 50,
        content: content.trim(),
        visibility,
        noteType: 'MARGIN_TEXT',
      });
      void r.noteId;
      setContent('');
      onCreated();
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker')) {
        await liff.shareTargetPicker([JSON.parse(r.flexMessageJson) as unknown]).catch(() => undefined);
        setMsg('สร้างโน้ตและแชร์ให้เพื่อนแล้ว!');
      } else {
        setMsg('สร้างโน้ตเรียบร้อยแล้ว!');
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function like(note: PageNote) {
    try {
      await socialApi().like({ noteId: note.id, ebookId, pageNumber });
      onCreated();
    } catch {
      /* like failure is non-fatal */
    }
  }

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div>
      <h3>โน้ตริมขอบ หน้า {pageNumber}</h3>
      <div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="เขียนข้อสังเกต..."
          maxLength={1000}
          aria-label="เขียนโน้ต"
        />
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as (typeof VISIBILITIES)[number])} aria-label="ความเป็นส่วนตัว">
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <button type="button" onClick={() => void create()} disabled={busy || !content.trim()}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกโน้ต'}
        </button>
        {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
      </div>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <p>
              {n.userDisplayName}
              {n.isAuthorNote ? ' ✦(ผู้เขียน)' : ''}: {n.content}
            </p>
            <button type="button" onClick={() => void like(n)} aria-label={`ถูกใจโน้ต ${n.id}`}>
              ♥ {n.likesCount}
            </button>
          </li>
        ))}
      </ul>
      {selected && <p>ดูโน้ต: {selected.content}</p>}
    </div>
  );
}

export default MarginNoteDrawer;
