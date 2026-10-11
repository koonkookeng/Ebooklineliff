// SSOT Phase 129 §6.1 — PDPA granular-consent bottom sheet (5-state client)
// Canonical: apps/frontend/components/security/PdpaConsentModal.tsx
// (legacy src/frontend/components/security/PdpaConsentModal.tsx)
// - Spec-verbatim purposes (mandatory NECESSARY_TERMS locked on, marketing +
//   analytics toggles). RISK_CALL: no icon package (not installed) — inline
//   SVG shield/lock (048/050 precedent). Tenant vars (--primary-color).
// - Pure collectPurposes() exported for contract tests. Zero new deps.
'use client';

import React, { useState } from 'react';

export interface PdpaConsentModalProps {
  isOpen: boolean;
  onAccept: (purposes: string[]) => void;
  tenantName: string;
}

export function collectPurposes(marketing: boolean, analytics: boolean): string[] {
  const purposes = ['NECESSARY_TERMS'];
  if (marketing) purposes.push('MARKETING_PROMOTION');
  if (analytics) purposes.push('ANALYTICS_BEHAVIOR');
  return purposes;
}

function ShieldIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l8 3.5v5.2c0 5-3.4 9.4-8 11.3-4.6-1.9-8-6.3-8-11.3V5.5L12 2z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M12 2l8 3.5v5.2c0 5-3.4 9.4-8 11.3-4.6-1.9-8-6.3-8-11.3V5.5L12 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
      />
      <path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export const PdpaConsentModal: React.FC<PdpaConsentModalProps> = ({ isOpen, onAccept, tenantName }) => {
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [analyticsAccepted, setAnalyticsAccepted] = useState(true);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onAccept(collectPurposes(marketingAccepted, analyticsAccepted));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="PDPA consent">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--primary-color, #10B981) 15%, white)', color: 'var(--primary-color, #10B981)' }}>
            <ShieldIcon />
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900">การคุ้มครองข้อมูลส่วนบุคคล (PDPA)</h3>
            <p className="text-xs text-slate-500">{tenantName}</p>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          เราให้ความสำคัญต่อความเป็นส่วนตัวของคุณ เพื่อให้คุณได้รับประสบการณ์การใช้งาน E-Book และคอร์สเรียนที่ดีที่สุด กรุณาเลือกตั้งค่าความเป็นส่วนตัว:
        </p>

        <div className="space-y-3 mb-6 text-sm">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <span className="font-medium text-slate-700 flex items-center gap-2">
              <LockIcon /> ข้อมูลที่จำเป็นต่อระบบ (Mandatory)
            </span>
            <span className="text-xs font-bold px-2 py-1 rounded" style={{ color: 'var(--primary-color, #059669)', background: 'color-mix(in srgb, var(--primary-color, #10B981) 15%, white)' }}>เปิดใช้งาน</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <span className="text-slate-700">วิเคราะห์พฤติกรรมเพื่อการปรับปรุงระบบ</span>
            <input
              type="checkbox"
              checked={analyticsAccepted}
              onChange={(e) => setAnalyticsAccepted(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer"
              aria-label="analytics consent"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <span className="text-slate-700">รับข้อเสนอและโปรโมชันพิเศษ</span>
            <input
              type="checkbox"
              checked={marketingAccepted}
              onChange={(e) => setMarketingAccepted(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer"
              aria-label="marketing consent"
            />
          </div>
        </div>

        <button
          onClick={handleConfirm}
          className="w-full py-3 text-white font-bold rounded-xl shadow-lg"
          style={{ background: 'var(--primary-color, #059669)' }}
        >
          ยอมรับและเข้าใช้งาน
        </button>
      </div>
    </div>
  );
};

export default PdpaConsentModal;
