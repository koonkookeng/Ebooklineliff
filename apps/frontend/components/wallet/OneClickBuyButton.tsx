// SSOT Phase 017 §6.1 — React 19 One-Click Buy button (double-click protected)
// Canonical: apps/frontend/components/wallet/OneClickBuyButton.tsx
// (legacy src/frontend/components/wallet/OneClickBuyButton.tsx)
'use client';

import React, { useState } from 'react';
import { executeOneClickBuy } from '../../lib/wallet';

interface OneClickBuyProps {
  productId: string;
  price: number;
  productTitle: string;
  onSuccess: (orderId: string) => void;
  onError?: (message: string) => void;
}

export function OneClickBuyButton({ productId, price, productTitle, onSuccess, onError }: OneClickBuyProps) {
  const [loading, setLoading] = useState(false);

  const handleOneClickBuy = async () => {
    if (loading) return;
    if (!confirm(`ยืนยันการใช้ ${price} Meb-Killer Credits เพื่อซื้อ "${productTitle}" ทันที?`)) return;
    setLoading(true);
    try {
      const result = await executeOneClickBuy(productId, price);
      if (result?.success) onSuccess(result.orderId);
      else onError?.('เกิดข้อผิดพลาดในการซื้อสินค้า');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการซื้อสินค้า';
      if (message.includes('ไม่เพียงพอ')) onError?.(`${message} — กรุณาเติมเงินด่วน`);
      else onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleOneClickBuy()}
      disabled={loading}
      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
    >
      {loading ? (
        <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
      ) : (
        <>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>ซื้อทันทีด้วย One-Click ({price} Credits)</span>
        </>
      )}
    </button>
  );
}

export default OneClickBuyButton;
