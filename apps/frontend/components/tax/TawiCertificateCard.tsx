// SSOT Phase 082 §2.2 — 50 Tawi certificate card (download + LINE share)
// Canonical: apps/frontend/components/tax/TawiCertificateCard.tsx
// - SUCCESS card with 15-min download link + LINE share-target fallback
//   (clipboard when the picker is unavailable). RAM-lean preview: no PDF
//   rendering in Webview (§2.1 LIFF_CONSTRAINTS — download instead).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { TaxCertificateRow } from '../../lib/tax/tax-client';

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { liff?: LiffGlobal }).liff ?? null;
}

export function TawiCertificateCard({ slug, cert }: { slug: string; cert: TaxCertificateRow }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function shareToLine() {
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/tax/certificates/generate?tenant=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grossAmount: cert.grossAmount }),
      });
      if (!res.ok) throw new Error(`generate ${res.status}`);
      const data = (await res.json()) as { downloadUrl: string; certificateNo: string };
      const text = `ใบ 50 ทวิ ${data.certificateNo} โหลดใน 15 นาที: ${data.downloadUrl}`;
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker')) {
        const out = await liff.shareTargetPicker([
          { type: 'text', text } as unknown,
        ]);
        if (out) setMsg('ส่งเข้า LINE Chat แล้ว!');
        else setMsg('ยกเลิกการแชร์');
      } else {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setMsg('คัดลอกลิงก์ดาวน์โหลดแล้ว!');
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <div>
        <span>{cert.certificateNo}</span>
        <span>หัก {cert.taxWithheld} · รับสุทธิ {cert.netAmount}</span>
      </div>
      <button type="button" onClick={() => void shareToLine()}>
        ส่งเข้า LINE Chat
      </button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
