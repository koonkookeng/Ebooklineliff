// SSOT Phase 080 §2.2/Task 5 — One-click Flex share button (5-state)
// Canonical: apps/frontend/components/share/FlexShareButton.tsx
// - IDLE shows the commission badge; LOADING a spinner line; SUCCESS a toast;
//   ERROR a fallback modal with copy-shortlink (BDD-1 fallback <50ms switch).
// - Zero-dep (React only); tenant accent via CSS var (§2.1 flex theming).
'use client';

import React, { useState } from 'react';
import { useLineFlexShare } from '../../hooks/useLineFlexShare';

export function FlexShareButton({
  slug,
  productId,
  targetType = 'PRODUCT_PDP',
  commissionLabel,
  customMessage,
}: {
  slug: string;
  productId: string;
  targetType?: string;
  commissionLabel?: string;
  customMessage?: string;
}) {
  const { status, shareUrl, error, executeFlexShare, retry } = useLineFlexShare(slug);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (shareUrl) await navigator.clipboard.writeText(shareUrl).catch(() => undefined);
    setCopied(true);
  }

  if (status === 'LIFF_INIT') {
    return (
      <div aria-busy="true" style={{ opacity: 0.6 }}>
        <button type="button" disabled style={{ background: 'var(--primary-color,#06C755)', color: '#fff' }}>
          กำลังเตรียมปุ่มแชร์…
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={status === 'LOADING' || !productId}
        onClick={() => void executeFlexShare(productId, targetType, customMessage).catch(() => undefined)}
        style={{ background: 'var(--primary-color,#06C755)', color: '#fff' }}
      >
        {status === 'LOADING' ? 'กำลังเตรียม Flex Card…' : 'แชร์ป้ายยาเพื่อน'}
        {commissionLabel && status === 'IDLE' ? ` (${commissionLabel})` : ''}
      </button>
      {status === 'SUCCESS' && <p role="status">ส่ง Flex Card เรียบร้อยแล้ว!</p>}
      {status === 'ERROR' && (
        <div role="alert">
          <p>แชร์ไม่สำเร็จ{error ? `: ${error}` : ''} — ส่งลิงก์ให้เพื่อนแทนได้ทันที</p>
          {shareUrl && (
            <button type="button" onClick={() => void copyLink()}>
              {copied ? 'คัดลอกแล้ว!' : 'คัดลอกลิงก์ช่วยขาย'}
            </button>
          )}
          <button type="button" onClick={retry}>
            ลองใหม่
          </button>
        </div>
      )}
    </div>
  );
}
