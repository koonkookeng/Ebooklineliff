// SSOT Phase 086 §6.1/Task 6 — Seller payout request form (dep-free)
// Canonical: apps/frontend/components/payout/PayoutRequestForm.tsx
// - RISK_CALL: no shadcn (spec asks it) — native inputs keep LIFF RAM lean
//   (Gate 5); double-submit locked via disabled state (Gate 4 safety).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { previewPayout } from '../../lib/payout/payout-client';

export function PayoutRequestForm(props: {
  availableBalance: number;
  bankDetails?: { bankName: string; accountNumber: string; accountName: string };
  kycVerified: boolean;
  onRequestSubmit: (amount: number) => Promise<void>;
}) {
  const { availableBalance, bankDetails, kycVerified, onRequestSubmit } = props;
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const numericAmount = parseFloat(amount) || 0;
  const { tax: taxAmount, net: netPayable } = previewPayout(numericAmount);

  async function handleSubmit() {
    if (numericAmount < 100) {
      setErrorMsg('จำนวนเงินถอนขั้นต่ำคือ 100 บาท');
      return;
    }
    if (numericAmount > availableBalance) {
      setErrorMsg('ยอดเงินถอนเกินกว่ายอดคงเหลือที่ถอนได้');
      return;
    }
    if (!kycVerified) {
      setErrorMsg('ต้องผ่าน e-KYC ก่อนถอนเงิน');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await onRequestSubmit(numericAmount);
      setAmount('');
    } catch (err) {
      setErrorMsg((err as Error).message || 'เกิดข้อผิดพลาดในการส่งคำขอถอนเงิน');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2>ถอนเงินรายได้ (Payout Request)</h2>
      {errorMsg && <p role="alert">{errorMsg}</p>}
      <div>
        <span>ยอดเงินคงเหลือพร้อมถอน:</span>
        <span>฿{availableBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
      <div>
        <label>
          ระบุจำนวนเงินที่ต้องการถอน (บาท)
          <input type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isSubmitting} />
        </label>
      </div>
      <div>
        <div>
          <span>หัก ภาษี ณ ที่จ่าย (3% e-Withholding Tax):</span>
          <span>-฿{taxAmount.toFixed(2)}</span>
        </div>
        <div>
          <span>ยอดเงินสุทธิที่จะได้รับเข้าบัญชี:</span>
          <span>฿{netPayable > 0 ? netPayable.toFixed(2) : '0.00'}</span>
        </div>
      </div>
      <div>
        <p>บัญชีธนาคารปลายทาง (e-KYC Verified):</p>
        {bankDetails ? (
          <>
            <p>{bankDetails.bankName} - {bankDetails.accountNumber}</p>
            <p>ชื่อบัญชี: {bankDetails.accountName}</p>
          </>
        ) : (
          <p>ใช้บัญชีที่ผูกไว้กับ e-KYC ของคุณ</p>
        )}
      </div>
      <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || numericAmount <= 0}>
        {isSubmitting ? 'กำลังส่งคำขอ...' : 'ยืนยันการถอนเงิน'}
      </button>
    </div>
  );
}
