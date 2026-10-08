// SSOT Phase 083 Task 7 — Badge gallery + LINE Flex share (dep-free)
// Canonical: apps/frontend/components/gamification/BadgeGallery.tsx
// - Locked badges render dimmed; unlocked ones share via window.liff with a
//   clipboard fallback (no @line/liff dep, Gate 5).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { GameBadge } from '../../lib/gamification/gamification-client';

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { liff?: LiffGlobal }).liff ?? null;
}

export function BadgeGallery({ badges, streakDays }: { badges: GameBadge[]; streakDays: number }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function shareBadge(b: GameBadge) {
    setMsg(null);
    const flex = {
      type: 'flex',
      altText: `🏆 ปลดล็อก Badge: ${b.name}`,
      contents: {
        type: 'bubble',
        hero: { type: 'image', url: b.iconUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🏆 ปลดล็อกความสำเร็จ!', weight: 'bold', color: '#F59E0B', size: 'sm' },
            { type: 'text', text: b.name, weight: 'bold', size: 'xl', margin: 'md', wrap: true },
            { type: 'text', text: `Streak ${streakDays} วัน — มาร่วมสะสมกัน!`, size: 'xs', color: '#10B981', margin: 'md' },
          ],
        },
      },
    };
    try {
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker')) {
        const out = await liff.shareTargetPicker([flex as unknown]);
        setMsg(out ? 'อวด Badge ลงแชตแล้ว!' : 'ยกเลิกการแชร์');
      } else {
        await navigator.clipboard.writeText(b.name).catch(() => undefined);
        setMsg('คัดลอกชื่อ Badge แล้ว!');
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    }
  }

  return (
    <section>
      <h2>ตู้สะสม Badge</h2>
      <ul>
        {badges.map((b) => (
          <li key={b.id} aria-disabled={!b.isUnlocked} style={{ opacity: b.isUnlocked ? 1 : 0.45 }}>
            <span>{b.name}</span>
            <span>+{b.pointsReward} แต้ม</span>
            {b.isUnlocked && (
              <button type="button" onClick={() => void shareBadge(b)}>
                อวดเพื่อน
              </button>
            )}
          </li>
        ))}
        {badges.length === 0 && <li>ยังไม่มี Badge — เช็กอินทุกวันเพื่อปลดล็อก</li>}
      </ul>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </section>
  );
}
