// SSOT Phase 031 Task 7 — Keep-alive checkout shell (slip draft preservation)
// Canonical: apps/frontend/components/checkout/PromptPayCheckout.tsx
// (legacy src/frontend/components/checkout/PromptPayCheckout.tsx)
// - The payment engine stays in PromptPayQRWidget/SlipUploadZone (untouched);
//   this shell owns the keep-alive track: step + orderId + slip draft survive
//   banking-app switches within the 15-minute restore window (BDD Scenario 3).
// - Draft slip preview (≤700KB Zod cap) rides the sessionStorage mirror, so the
//   upload progress repaints instantly with 0 network on resume.
// - Renders a compact step/draft summary + resume slot (children) for hosts.
// - Zero new deps.
'use client';

import React, { useEffect, useState } from 'react';
import { useViewportKeepAlive } from '../keep-alive/useKeepAlive';

export type CheckoutStep = 'ADDRESS' | 'PROMPTPAY_QR' | 'SLIP_UPLOAD';

/** Hosts announce slip drafts without touching this shell (decoupled, opt-in). */
export const SLIP_DRAFT_EVENT = 'keepalive:slip-draft';

interface PromptPayCheckoutProps {
  orderId: string;
  expiresAt: string;
  children?: React.ReactNode;
}

export function PromptPayCheckout({ orderId, expiresAt, children }: PromptPayCheckoutProps) {
  const [step, setStep] = useState<CheckoutStep>('PROMPTPAY_QR');
  const [slipName, setSlipName] = useState<string | null>(null);
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const slipRef = React.useRef<string | null>(null);

  useEffect(() => {
    const onDraft = (e: Event) => {
      const base64 = (e as CustomEvent<string | null>).detail ?? null;
      slipRef.current = base64;
      setSlipName(base64 ? 'slip-restored.png' : null);
    };
    window.addEventListener(SLIP_DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(SLIP_DRAFT_EVENT, onDraft);
  }, []);

  const keepAlive = useViewportKeepAlive({
    viewportType: 'CHECKOUT_FORM',
    resourceId: orderId,
    snapshot: () => ({
      orderId,
      step: stepRef.current,
      ...(slipRef.current ? { draftSlipBase64: slipRef.current } : {}),
      expiresAt,
    }),
    rehydrate: (s) => {
      setStep(s.step);
      if (s.draftSlipBase64) {
        slipRef.current = s.draftSlipBase64;
        setSlipName('slip-restored.png');
      }
    },
  });

  return (
    <div data-testid="promptpay-checkout" data-step={step}>
      {keepAlive.status === 'HYDRATING' && <div aria-busy>Skeleton restoring checkout…</div>}
      {keepAlive.status === 'ERROR_FALLBACK' && <div role="status">กู้คืนหน้าจอล่าสุดสำเร็จ</div>}
      <p>
        คำสั่งซื้อ {orderId} — ขั้นตอน {step}
        {slipName ? ` — สลิป ${slipName} (กู้คืนแล้ว)` : ''}
      </p>
      {children}
    </div>
  );
}

export default PromptPayCheckout;
