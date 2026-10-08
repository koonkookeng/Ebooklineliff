'use client';

// SSOT Phase 073 §6 — Role-based merchant sidebar (Zero Redundant shared nav)
// Canonical: apps/frontend/components/dashboard/MerchantSidebar.tsx
// - MERCHANT_VIEW (stock/parcels/labels), INSTRUCTOR_VIEW (courses/HLS/quiz
//   stats), HYBRID_VIEW (union). Role persists in localStorage.
// - Zero-dep (React only; tenant brand via CSS vars).
import React, { useEffect, useState } from 'react';

export type MerchantView = 'MERCHANT_VIEW' | 'INSTRUCTOR_VIEW' | 'HYBRID_VIEW';

const VIEW_KEY = 'merchant-view';

const MENUS: Record<MerchantView, Array<{ href: string; label: string }>> = {
  MERCHANT_VIEW: [
    { href: '/merchant', label: 'ภาพรวมร้าน' },
    { href: '/merchant/products', label: 'สต็อกสินค้า' },
    { href: '/merchant/orders', label: 'พัสดุ & ใบปะหน้า' },
    { href: '/merchant/payouts', label: 'เบิกถอนเงิน' },
    { href: '/merchant/analytics', label: 'ยอดขาย' },
  ],
  INSTRUCTOR_VIEW: [
    { href: '/merchant', label: 'ภาพรวม' },
    { href: '/merchant/products', label: 'คอร์สเรียน' },
    { href: '/merchant/studio', label: 'สตูดิโอ HLS' },
    { href: '/merchant/payouts', label: 'เบิกถอนเงิน' },
    { href: '/merchant/analytics', label: 'สถิติวิดีโอ' },
  ],
  HYBRID_VIEW: [
    { href: '/merchant', label: 'ภาพรวม' },
    { href: '/merchant/products', label: 'สินค้า & คอร์ส' },
    { href: '/merchant/studio', label: 'สตูดิโอ HLS' },
    { href: '/merchant/orders', label: 'พัสดุ & ใบปะหน้า' },
    { href: '/merchant/payouts', label: 'เบิกถอนเงิน' },
    { href: '/merchant/analytics', label: 'วิเคราะห์' },
  ],
};

export function MerchantSidebar({ storeName, logoUrl }: { storeName: string; logoUrl?: string }) {
  const [view, setView] = useState<MerchantView>('HYBRID_VIEW');
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY) as MerchantView | null;
      if (saved && MENUS[saved]) setView(saved);
    } catch {
      // Private mode: stay hybrid.
    }
  }, []);

  function switchView(next: MerchantView) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Best-effort persistence.
    }
  }

  return (
    <aside
      className="merchant-sidebar"
      style={{ background: 'var(--primary, #059669)', color: '#fff' }}
      data-open={open}
    >
      <div className="merchant-brand">
        {logoUrl ? <img src={logoUrl} alt={storeName} width={32} height={32} /> : null}
        <strong>{storeName}</strong>
        <button type="button" onClick={() => setOpen(!open)} aria-label="toggle sidebar">
          ☰
        </button>
      </div>
      {open && (
        <>
          <nav>
            {MENUS[view].map((m) => (
              <a key={m.href} href={m.href} className="merchant-link">
                {m.label}
              </a>
            ))}
          </nav>
          <div className="merchant-view-switch">
            {(Object.keys(MENUS) as MerchantView[]).map((v) => (
              <button
                key={v}
                type="button"
                disabled={v === view}
                onClick={() => switchView(v)}
              >
                {v.replace('_VIEW', '')}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
