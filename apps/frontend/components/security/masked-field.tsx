// SSOT Phase 107 §6.1 — MaskedDataField (5-state masked display + timed unmask)
// Canonical: apps/frontend/components/security/masked-field.tsx
// (legacy src/frontend/components/security/masked-field.tsx)
// - LIFF_INIT loads nothing (masked value is server-rendered) -> IDLE masked +
//   lock icon + "ดูข้อมูลจริง"; LOADING spinner on OTP/verify POST; SUCCESS
//   plaintext with 30s countdown then re-mask; ERROR toast + audit.
// - Plaintext lives in React state only (unmounted + timer-cleared, Gate 5).
// - Zero new deps (no animation libs; CSS tokens --pii-*).
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { requestUnmask } from '../../lib/security/pii-client';

export type PiiUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface MaskedFieldProps {
  label: string;
  maskedValue: string;
  fieldType: 'PHONE' | 'BANK' | 'ID_CARD';
  targetUserId: string;
}

const FIELD_TYPE_MAP: Record<MaskedFieldProps['fieldType'], string> = {
  PHONE: 'PHONE_NUMBER',
  BANK: 'BANK_ACCOUNT',
  ID_CARD: 'NATIONAL_ID',
};

export const MaskedDataField: React.FC<MaskedFieldProps> = ({
  label,
  maskedValue,
  fieldType,
  targetUserId,
}) => {
  const [uiState, setUiState] = useState<PiiUiState>('LIFF_INIT');
  const [unmaskedValue, setUnmaskedValue] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setUiState('IDLE');
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleUnmaskRequest = async (): Promise<void> => {
    setUiState('LOADING');
    setNotice(null);
    try {
      const result = await requestUnmask({
        targetUserId,
        fieldType: FIELD_TYPE_MAP[fieldType],
        reason: 'Support verification',
      });
      if (!result) throw new Error('unmask denied');
      setUnmaskedValue(result.plainText);
      setTimeLeft(result.expiresInSec || 30);
      setUiState('SUCCESS');
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            setUnmaskedValue(null);
            setUiState('IDLE');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setNotice('ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนบุคคลนี้');
      setUiState('ERROR');
    }
  };

  const isLoading = uiState === 'LOADING';

  return (
    <div
      data-testid="masked-data-field"
      data-ui-state={uiState}
      className="p-3 border rounded-lg bg-gray-50 flex justify-between items-center text-sm"
      style={{ ['--pii-mask-blur' as string]: '4px' }}
    >
      <div>
        <span className="text-xs text-gray-500 block">
          <span aria-hidden>🔒</span> {label}
        </span>
        <span className="font-mono font-semibold text-gray-800" data-testid="pii-value">
          {unmaskedValue || maskedValue}
        </span>
        {notice ? (
          <span role="alert" className="text-xs text-red-600 block">
            {notice}
          </span>
        ) : null}
      </div>
      {unmaskedValue ? (
        <span className="text-xs text-red-500 font-semibold">ซ่อนใน {timeLeft}s</span>
      ) : (
        <button
          type="button"
          onClick={handleUnmaskRequest}
          disabled={isLoading}
          className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
        >
          {isLoading ? 'กำลังตรวจสิทธิ์...' : 'ดูข้อมูลจริง'}
        </button>
      )}
    </div>
  );
};

export default MaskedDataField;
