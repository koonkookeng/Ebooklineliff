// SSOT Phase 019 §6 — LIFF E-Receipt view (5 states, tenant theme, zero heavy deps)
// Canonical: apps/frontend/app/(liff)/receipt/[orderId]/page.tsx
// (legacy src/frontend/app/(liff)/receipt/[orderId]/page.tsx)
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { fetchReceiptDetail, requestReceipt, type ReceiptDetail } from '../../../../lib/receipt';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'กำลังจัดเตรียมใบเสร็จ...',
  COMPOSING: 'กำลังประกอบใบเสร็จ...',
  SENT: 'ส่งใบเสร็จแล้ว',
  DELIVERED: 'ส่งใบเสร็จทาง LINE แล้ว',
  FAILED_RETRYING: 'ส่งไม่สำเร็จ กำลังลองใหม่...',
  FAILED_PERMANENT: 'ส่งทาง LINE ไม่สำเร็จ (ดาวน์โหลด PDF ด้านล่างได้)',
};

function LiffReceiptInner() {
  const params = useParams<{ orderId: string }>();
  const search = useSearchParams();
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const accent = search.get('color') ?? '#00C751';
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [uiState, setUiState] = useState<UiState>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) {
      setError('ไม่พบรหัสคำสั่งซื้อ');
      setUiState('ERROR');
      return;
    }
    setError(null);
    setUiState('LOADING');
    try {
      const data = await fetchReceiptDetail(orderId);
      setDetail(data);
      setUiState(data.status === 'DELIVERED' ? 'SUCCESS' : 'IDLE');
    } catch (e) {
      setError((e as Error).message);
      setUiState('ERROR');
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resend = useCallback(async () => {
    if (!orderId) return;
    setUiState('LOADING');
    setError(null);
    try {
      await requestReceipt(orderId, true);
      const data = await fetchReceiptDetail(orderId);
      setDetail(data);
      setUiState(data.status === 'DELIVERED' ? 'SUCCESS' : 'IDLE');
    } catch (e) {
      setError((e as Error).message);
      setUiState('ERROR');
    }
  }, [orderId]);

  if (uiState === 'LIFF_INIT' || (uiState === 'LOADING' && !detail)) {
    return (
      <main className="mx-auto max-w-md px-4 py-6" aria-busy="true">
        <div className="h-6 w-44 rounded bg-gray-100 animate-pulse" />
        <div className="mt-4 h-64 rounded-2xl bg-gray-100 animate-pulse" />
      </main>
    );
  }

  if (uiState === 'ERROR' && !detail) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-slate-500">{error ?? 'เกิดข้อผิดพลาด'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 px-6 py-2.5 text-white text-sm font-bold rounded-xl"
          style={{ background: accent }}
        >
          ลองอีกครั้ง
        </button>
      </main>
    );
  }

  if (!detail) return null;

  return (
    <main className="mx-auto max-w-md px-4 py-6 pb-28" style={{ ['--primary-color' as string]: accent }}>
      <section className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
        <div className="p-5 text-white" style={{ background: '#111827' }}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold" style={{ color: accent }}>
              E-RECEIPT
            </span>
            <span className="text-[11px] text-slate-300">#{detail.orderNumber}</span>
          </div>
          <p className="mt-2 text-3xl font-extrabold tabular-nums">
            ฿{detail.netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-[11px] text-slate-400" role="status">
            {STATUS_LABEL[detail.status] ?? detail.status}
          </p>
        </div>
        <div className="p-4 bg-white">
          <ul className="divide-y divide-slate-100">
            {detail.items.map((i, ix) => (
              <li key={ix} className="py-2 flex justify-between text-xs">
                <span className="text-slate-600">
                  {i.title} <span className="text-slate-400">(x{i.quantity})</span>
                </span>
                <span className="font-bold text-slate-800 tabular-nums">
                  ฿{i.totalPrice.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </li>
            ))}
          </ul>
          {error && (
            <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg" role="alert">
              {error}
            </div>
          )}
          <div className="mt-4 space-y-2">
            {detail.downloadUrl ? (
              <a
                href={detail.downloadUrl}
                className="block text-center w-full py-3 text-white font-bold rounded-xl text-sm"
                style={{ background: accent }}
              >
                ดาวน์โหลดใบเสร็จ (PDF)
              </a>
            ) : (
              <button
                type="button"
                onClick={() => void resend()}
                disabled={uiState === 'LOADING'}
                className="w-full py-3 text-white font-bold rounded-xl text-sm disabled:opacity-50"
                style={{ background: accent }}
              >
                {uiState === 'LOADING' ? 'กำลังจัดเตรียม...' : 'ขอใบเสร็จอีกครั้ง'}
              </button>
            )}
            <a
              href={detail.liffLibraryUrl}
              className="block text-center w-full py-3 bg-slate-900 text-white font-bold rounded-xl text-sm"
            >
              เข้าสู่คลังหนังสือ / คอร์สเรียน
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function LiffReceiptPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-6" aria-busy="true"><div className="h-64 rounded-2xl bg-gray-100 animate-pulse" /></main>}>
      <LiffReceiptInner />
    </Suspense>
  );
}
