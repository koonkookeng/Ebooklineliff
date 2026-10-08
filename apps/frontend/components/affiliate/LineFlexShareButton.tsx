// SSOT Phase 079 §6.1/Task 4 — One-click LINE Flex share button
// Canonical: apps/frontend/components/affiliate/LineFlexShareButton.tsx
// - RISK_CALL (documented): no @line/liff dep (§6.1 asks it) — share rides
//   the window.liff global when present, clipboard fallback otherwise.
//   Flex JSON comes from the server builder (signed tracking code).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { affiliateApi } from '../../lib/affiliate/affiliate-client';

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  const w = window as Window & { liff?: LiffGlobal };
  return w.liff ?? null;
}

export function LineFlexShareButton({ slug, productId, productTitle }: { slug: string; productId: string; productTitle: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await affiliateApi(slug).flexShare({ productId, productTitle });
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker')) {
        const out = await liff.shareTargetPicker([JSON.parse(res.flexMessageJson) as unknown]);
        if (out) setMsg('ส่งการ์ดป้ายยาเข้าแชต LINE เรียบร้อยแล้ว!');
        else setMsg('ยกเลิกการแชร์');
      } else {
        await navigator.clipboard.writeText(res.shareUrl).catch(() => undefined);
        setMsg('คัดลอกลิงก์ช่วยขายแล้ว! ส่งให้เพื่อนในแชตได้ทันที');
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void share()} style={{ background: '#06C755', color: '#fff' }}>
        {busy ? 'กำลังเปิดหน้าแชร์...' : 'ป้ายยาเพื่อนผ่าน LINE Flex Card'}
      </button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
