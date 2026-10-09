// SSOT Phase 084 Task 7 — Recovery bottom sheet + live coupon countdown
// Canonical: apps/frontend/components/messaging/RecoverySheet.tsx
// - Tenant vars (§2.1); ticking countdown without animation libs (Gate 5).
// - Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { countdownParts, type RecoverySession } from '../../lib/messaging/recovery-client';

export function RecoverySheet({ session }: { session: RecoverySession }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!session.expiresAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [session.expiresAt]);

  const { mm, ss, live } = countdownParts(session.expiresAt);
  const net = Math.round((session.totalAmount - (session.discountAmount ?? 0)) * 100) / 100;

  return (
    <div style={{ background: 'var(--abandoned-banner-bg,#FFF7ED)' }}>
      <h2>ยินดีต้อนรับกลับ! กู้ตะกร้าแล้ว</h2>
      <ul>
        {session.items.map((i) => (
          <li key={i.productId}>
            <span>{i.title}</span>
            <span>
              x{i.quantity} · ฿{(i.price * i.quantity).toLocaleString('th-TH')}
            </span>
          </li>
        ))}
      </ul>
      {session.recoveryCouponCode && (
        <div style={{ borderColor: 'var(--timer-accent-color,#F59E0B)' }}>
          <span>คูปอง {session.recoveryCouponCode} ปรับใช้แล้ว −฿{(session.discountAmount ?? 0).toLocaleString('th-TH')}</span>
          <span>
            {live ? `หมดใน ${mm}:${String(ss).padStart(2, '0')}` : 'คูปองหมดอายุ — ยอดเต็มไม่มีส่วนลด'}
          </span>
        </div>
      )}
      <div>
        <span>ยอดชำระ ฿{net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
      <a href="/checkout" style={{ background: 'var(--flex-brand-primary,#06C755)' }}>
        ชำระเงิน PromptPay
      </a>
    </div>
  );
}
