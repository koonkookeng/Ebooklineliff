'use client';
// SSOT Phase 051 §6.x — paywall modal (glass overlay + instant checkout + LINE share)
// Canonical: apps/frontend/components/checkout/PaywallModal.tsx
// (legacy src/frontend/components/checkout/PaywallModal.tsx)
// - 6-state machine endpoint: PREVIEW_LIMIT_REACHED → CHECKOUT_PAYWALL.
// - Glassmorphism backdrop-blur; unmount-on-close (no hidden DOM ⇒ RAM guard).
// - Zero new deps: QR via PromptPayQrDisplay, share via NativeActionButton,
//   buy via plain navigation to the Phase 012/013 checkout flow (payment core
//   untouched per OUT_OF_SCOPE_STRICT).
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PromptPayQrDisplay } from './PromptPayQrDisplay';
import { NativeActionButton } from '../share/NativeActionButton';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productTitle: string;
  price: number;
  discountPrice?: number;
  coverImageUrl: string;
  reachedMessage: string;
  /** Optional pre-minted PromptPay payload (Phase 013); CTA fallback otherwise. */
  qrPayload?: string;
  qrExpiresAt?: string;
  shareContentType?: 'EBOOK_SUMMARY' | 'COURSE_LESSON' | 'PRODUCT_BUNDLE';
}

export function PaywallModal({
  isOpen,
  onClose,
  productId,
  productTitle,
  price,
  discountPrice,
  coverImageUrl,
  reachedMessage,
  qrPayload,
  qrExpiresAt,
  shareContentType = 'PRODUCT_BUNDLE',
}: PaywallModalProps) {
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null; // unmount strategy: zero retained RAM

  const effective = discountPrice ?? price;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="paywall"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-6 text-slate-900 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverImageUrl} alt={productTitle} className="mx-auto h-28 w-20 rounded-lg object-cover shadow" />
        <p className="mt-3 text-center text-sm font-semibold text-amber-600">{reachedMessage}</p>
        <h2 className="mt-1 text-center text-lg font-bold">{productTitle}</h2>
        <p className="mt-1 text-center text-sm text-slate-500">
          {discountPrice ? (
            <>
              <span className="line-through">฿{price}</span>{' '}
              <span className="font-bold text-emerald-600">฿{discountPrice}</span>
            </>
          ) : (
            <span className="font-bold text-slate-900">฿{price}</span>
          )}
        </p>

        {qrPayload && qrExpiresAt ? (
          <div className="mt-4 flex justify-center">
            <PromptPayQrDisplay qrPayload={qrPayload} amount={effective} expiresAt={qrExpiresAt} compact />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push(`/checkout?productId=${encodeURIComponent(productId)}`)}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-600"
          >
            ซื้อเลยผ่าน PromptPay
          </button>
        )}

        <div className="mt-3">
          <NativeActionButton productId={productId} contentType={shareContentType} variant="inline" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-600"
        >
          ไว้ทีหลัง
        </button>
      </div>
    </div>
  );
}

export default PaywallModal;
