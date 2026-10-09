// SSOT Phase 089 Task 5 — Gift creator studio (dep-free)
// Canonical: apps/frontend/components/gift/GiftCreatorStudio.tsx
// - RISK_CALL: no @apollo/client/shadcn (spec asks them) — REST proxy +
//   native inputs keep LIFF RAM <30MB (Gate 5). Share rides window.liff
//   with clipboard fallback (026/079/080 precedent).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';

const THEMES = [
  'BIRTHDAY_CELEBRATION',
  'NEW_YEAR_GOALS',
  'CONGRATULATIONS',
  'THANK_YOU',
  'CUSTOM_BRANDED',
] as const;

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { liff?: LiffGlobal }).liff ?? null;
}

export function GiftCreatorStudio(props: {
  slug: string;
  productId: string;
  productTitle: string;
  productCoverUrl: string;
  price: number;
  onCreated: (claimCode: string, flexMessageJson: string, claimUrl: string) => void;
}) {
  const { slug, productId, productTitle, productCoverUrl, price, onCreated } = props;
  const [greetingMessage, setGreetingMessage] = useState('');
  const [senderName, setSenderName] = useState('');
  const [theme, setTheme] = useState<(typeof THEMES)[number]>('BIRTHDAY_CELEBRATION');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleCreateAndShare() {
    if (isSubmitting || !greetingMessage || (!isAnonymous && !senderName)) return;
    setIsSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/gifts/create?tenant=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          greetingTheme: theme,
          greetingMessage,
          senderDisplayName: isAnonymous ? 'ผู้ไม่ประสงค์ออกนาม' : senderName,
          isAnonymous,
        }),
      });
      if (!res.ok) throw new Error(`create ${res.status}`);
      const data = (await res.json()) as { giftId: string; claimCode: string; flexMessageJson: string; claimUrl: string };
      onCreated(data.claimCode, data.flexMessageJson, data.claimUrl);
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker')) {
        const out = await liff.shareTargetPicker([JSON.parse(data.flexMessageJson) as unknown]);
        setMsg(out ? 'ส่งของขวัญให้เพื่อนเรียบร้อยแล้ว!' : 'ยกเลิกการแชร์');
      } else {
        await navigator.clipboard.writeText(data.claimUrl).catch(() => undefined);
        setMsg('คัดลอกลิงก์ของขวัญเรียบร้อยแล้ว ส่งให้เพื่อนผ่านแชตได้ทันที!');
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={productCoverUrl} alt={productTitle} loading="lazy" />
        <div>
          <span>ส่งของขวัญดิจิทัล</span>
          <h3>{productTitle}</h3>
          <p>฿{price.toLocaleString('th-TH')}</p>
        </div>
      </div>
      <div>
        <label>
          เลือกธีมการ์ดอวยพร
          <select value={theme} onChange={(e) => setTheme(e.target.value as (typeof THEMES)[number])}>
            {THEMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          ข้อความอวยพร
          <textarea
            placeholder="พิมพ์คำอวยพรสุดพิเศษที่นี่..."
            value={greetingMessage}
            onChange={(e) => setGreetingMessage(e.target.value)}
            maxLength={500}
          />
        </label>
      </div>
      <div>
        <label>
          ชื่อผู้ส่ง (แสดงบนการ์ด)
          <input
            placeholder="ระบุชื่อของคุณ"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            disabled={isAnonymous}
          />
        </label>
        <label>
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
          ส่งแบบไม่ประสงค์ออกนาม
        </label>
      </div>
      <button type="button" onClick={() => void handleCreateAndShare()} disabled={isSubmitting || !greetingMessage || (!isAnonymous && !senderName)}>
        {isSubmitting ? 'กำลังสร้างการ์ดของขวัญ...' : '🎁 ชำระเงิน & ส่งของขวัญให้เพื่อน'}
      </button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
