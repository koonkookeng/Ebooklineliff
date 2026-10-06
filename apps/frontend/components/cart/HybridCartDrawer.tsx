// SSOT Phase 011 §6.2 — LINE LIFF hybrid cart drawer (digital/physical split, 5 states)
// Canonical: apps/frontend/components/cart/HybridCartDrawer.tsx
// (legacy src/frontend/components/cart/**/*)
'use client';

import React from 'react';
import type { SmartCartItem } from '@repo/shared';
import { useCartStore } from '../../stores/useCartStore';

function ItemRow({ item, onQty, onRemove, busy }: {
  item: SmartCartItem;
  onQty: (qty: number) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="p-3 shadow-sm border border-slate-100 rounded-xl bg-white">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.coverImageUrl} alt="" loading="lazy" className="w-14 h-[4.5rem] object-cover rounded" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-1">{item.title}</p>
          <p className="text-xs text-slate-500 mt-1">ประเภท: {item.productType}</p>
          {item.itemCategory === 'PHYSICAL' && (
            <p className="text-xs text-slate-500 mt-0.5">น้ำหนัก: {item.weightGrams}g × {item.quantity}</p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="ลดจำนวน"
                disabled={busy || item.quantity <= 1}
                onClick={() => onQty(item.quantity - 1)}
                className="w-7 h-7 rounded-full border text-sm disabled:opacity-40"
              >
                −
              </button>
              <span className="text-sm w-6 text-center">{item.quantity}</span>
              <button
                type="button"
                aria-label="เพิ่มจำนวน"
                disabled={busy || item.quantity >= 99}
                onClick={() => onQty(item.quantity + 1)}
                className="w-7 h-7 rounded-full border text-sm disabled:opacity-40"
              >
                ＋
              </button>
            </div>
            <p className={`text-sm font-bold ${item.itemCategory === 'DIGITAL' ? 'text-emerald-600' : 'text-slate-900'}`}>
              ฿{(item.unitPrice * item.quantity).toLocaleString()}
            </p>
          </div>
          <button type="button" onClick={onRemove} disabled={busy} className="mt-1 text-[11px] text-red-500 disabled:opacity-40">
            นำออก
          </button>
        </div>
      </div>
    </div>
  );
}

export function HybridCartDrawer() {
  const store = useCartStore();
  const { digitalItems, physicalItems, requiresShippingAddress, grandTotalAmount, uiState, error } = store;
  const busy = uiState === 'LOADING' || uiState === 'LIFF_INIT';

  if (uiState === 'LIFF_INIT' || (uiState === 'LOADING' && digitalItems.length === 0 && physicalItems.length === 0)) {
    return (
      <div className="w-full max-w-md mx-auto p-4 space-y-3" aria-busy="true">
        <div className="h-7 w-48 rounded bg-gray-100 animate-pulse" />
        {[0, 1].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  const empty = digitalItems.length === 0 && physicalItems.length === 0;

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 pb-24">
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <span aria-hidden="true">🛍️</span>
          ตะกร้าสินค้าอัจฉริยะ (Smart Cart)
        </h2>
      </div>

      {error && (
        <div role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 p-2.5 rounded-xl flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => store.refresh()} className="font-bold underline">ลองใหม่</button>
        </div>
      )}

      {empty ? (
        <div className="text-center py-10 space-y-2">
          <p className="text-sm text-gray-500">ตะกร้าของคุณยังว่างอยู่</p>
          <a href="/catalog" className="inline-block text-sm px-5 py-2 rounded-full border">เลือกซื้อสินค้า</a>
        </div>
      ) : (
        <>
          {digitalItems.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <span aria-hidden="true">⚡</span>
                  สินค้าดิจิทัล (จัดส่งทันที 0 บาท)
                </span>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">
                  ไม่ต้องใช้ที่อยู่
                </span>
              </div>
              {digitalItems.map((item) => (
                <ItemRow
                  key={item.cartItemId}
                  item={item}
                  busy={busy}
                  onQty={(q) => store.updateQty(item.cartItemId, q)}
                  onRemove={() => store.remove(item.cartItemId)}
                />
              ))}
            </div>
          )}

          {physicalItems.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-600 flex items-center gap-1">
                  <span aria-hidden="true">🚚</span>
                  สินค้าเล่มจริง/พัสดุ (จัดส่งทางขนส่ง)
                </span>
                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">
                  คำนวณตามน้ำหนัก
                </span>
              </div>
              {physicalItems.map((item) => (
                <ItemRow
                  key={item.cartItemId}
                  item={item}
                  busy={busy}
                  onQty={(q) => store.updateQty(item.cartItemId, q)}
                  onRemove={() => store.remove(item.cartItemId)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 shadow-lg">
        <div className="max-w-md mx-auto space-y-2">
          {requiresShippingAddress && (
            <p className="text-[11px] text-amber-600 bg-amber-50 p-2 rounded text-center">
              ⚠️ คำสั่งซื้อนี้มีสินค้าจริง ต้องระบุที่อยู่จัดส่งในขั้นตอนถัดไป
            </p>
          )}
          <div className="text-xs text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>ดิจิทัล</span>
              <span>฿{store.digitalSubtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>สินค้าจริง</span>
              <span>฿{store.physicalSubtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>ค่าจัดส่ง</span>
              <span>{store.estimatedShippingFee === 0 ? '—' : `฿${store.estimatedShippingFee.toLocaleString()}`}</span>
            </div>
          </div>
          <div className="flex justify-between items-center text-base font-bold">
            <span>ราคารวมสุทธิ:</span>
            <span className="text-lg text-emerald-600">฿{grandTotalAmount.toLocaleString()}</span>
          </div>
          <button
            type="button"
            disabled={busy || empty}
            onClick={() => { window.location.href = '/checkout'; }}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
          >
            {busy ? 'กำลังคำนวณ...' : 'ดำเนินการชำระเงิน (PromptPay QR)'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default HybridCartDrawer;
