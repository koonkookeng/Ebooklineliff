// SSOT Phase 078 BDD-3/Task 6 — Quiz builder form + live preview
// Canonical: apps/frontend/components/studio/quiz-builder.tsx
// - Option rows with correct-flag, points, explanation; live learner preview
//   (correct flags hidden); save/delete via REST.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { studioApi } from '../../lib/studio/studio-client';

interface OptionRow {
  id: string;
  optionText: string;
  isCorrect: boolean;
}

function uid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function QuizBuilder({ slug, lessonId }: { slug: string; lessonId: string }) {
  const [question, setQuestion] = useState('');
  const [explanation, setExplanation] = useState('');
  const [points, setPoints] = useState(10);
  const [options, setOptions] = useState<OptionRow[]>([
    { id: uid(), optionText: '', isCorrect: true },
    { id: uid(), optionText: '', isCorrect: false },
  ]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await studioApi(slug).saveQuiz({ lessonId, question, explanation, points, options });
      setMsg(`บันทึกข้อสอบสำเร็จ (${res.id.slice(0, 8)})`);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <form onSubmit={save} className="merchant-form">
        <input placeholder="คำถาม (≥3 ตัวอักษร)" value={question} onChange={(e) => setQuestion(e.target.value)} required />
        {options.map((o, ix) => (
          <div key={o.id} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder={`ตัวเลือก ${ix + 1}`}
              value={o.optionText}
              onChange={(e) => setOptions((os) => os.map((x) => (x.id === o.id ? { ...x, optionText: e.target.value } : x)))}
              required
            />
            <label>
              <input
                type="checkbox"
                checked={o.isCorrect}
                onChange={(e) => setOptions((os) => os.map((x) => (x.id === o.id ? { ...x, isCorrect: e.target.checked } : x)))}
              />
              ถูก
            </label>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setOptions((os) => [...os, { id: uid(), optionText: '', isCorrect: false }])}>
            + ตัวเลือก
          </button>
          <input type="number" value={points} min={1} onChange={(e) => setPoints(Number(e.target.value) || 10)} style={{ width: 90 }} />
          <input placeholder="คำอธิบาย (ไม่บังคับ)" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        <button type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกข้อสอบ'}</button>
        {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
      </form>
      <div>
        <h4>พรีวิวผู้เรียน (ไม่เฉลย)</h4>
        <p><strong>{question || '(คำถาม)'}</strong> <span>[{points} คะแนน]</span></p>
        {options.map((o) => (
          <p key={o.id}>○ {o.optionText || '(ตัวเลือก)'}</p>
        ))}
        {explanation && <p style={{ color: '#64748b' }}>หลังตรวจ: {explanation}</p>}
      </div>
    </div>
  );
}
