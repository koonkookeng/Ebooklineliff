// SSOT Phase 014 §6.1 — Slip verification hook (compress → upload → verify pipeline)
// Canonical: apps/frontend/hooks/useSlipVerification.ts
// (legacy src/frontend/hooks/useSlipVerification.ts)
// Stages surface the spec's 5-state matrix; errors are mapped to Thai
// retry guidance (replay / amount / account / provider outage).
'use client';

import { useCallback, useRef, useState } from 'react';
import { compressSlipImage } from '../lib/slip-image';
import type { SlipVerificationResponse } from '@repo/shared';

export type SlipStage = 'idle' | 'compressing' | 'uploading' | 'verifying' | 'done';
export type SlipUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

/** Success outcome carries the post-compression size (single-compress pipeline). */
export type SlipVerifyOutcome = (SlipVerificationResponse & { compressedKb: number }) | null;

function friendlyError(message: string): string {
  if (/SLIP_ALREADY_USED|เคยถูกใช้งาน/.test(message)) return 'สลิปรายการนี้เคยถูกใช้งานแล้ว กรุณาใช้สลิปใหม่';
  if (/does not match|น้อยกว่า|ยอดเงิน/.test(message)) return 'ยอดเงินในสลิปไม่ตรง กรุณาตรวจสอบเศษสตางค์แล้วลองใหม่';
  if (/account|บัญชี/.test(message)) return 'บัญชีผู้รับไม่ถูกต้อง กรุณาสแกน QR ใหม่';
  if (/หมดอายุ|expired/i.test(message)) return 'QR หมดอายุแล้ว กรุณาสร้าง QR ใหม่';
  return message || 'การตรวจสอบสลิปล้มเหลว กรุณาลองใหม่หรือติดต่อแอดมิน';
}

async function postVerify(body: Record<string, string>): Promise<SlipVerificationResponse> {
  const res = await fetch('/api/v1/payment/verify-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (SlipVerificationResponse & { message?: string }) | null;
  if (!res.ok) throw new Error(data?.message ?? 'การตรวจสอบสลิปล้มเหลว');
  return data as SlipVerificationResponse;
}

export function useSlipVerification() {
  const [stage, setStage] = useState<SlipStage>('idle');
  const [uiState, setUiState] = useState<SlipUiState>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SlipVerificationResponse | null>(null);
  const [fileSizeKb, setFileSizeKb] = useState<number | null>(null);
  const live = useRef(true);

  const reset = useCallback(() => {
    setStage('idle');
    setUiState('IDLE');
    setError(null);
    setResult(null);
    setFileSizeKb(null);
  }, []);

  /**
   * Compresses (≤300KB) → uploads to R2 → verifies (<0.8s SLA).
   * Falls back to direct-base64 v1 verification if the R2 upload fails.
   * Compression runs exactly once; the outcome reports its size.
   */
  const verifySlip = useCallback(async (orderId: string, file: File, tenantId: string): Promise<SlipVerifyOutcome> => {
    live.current = true;
    setError(null);
    setResult(null);
    setUiState('LOADING');
    try {
      setStage('compressing');
      const compressed = await compressSlipImage(file);
      if (!live.current) return null;
      setFileSizeKb(compressed.fileSizeKb);

      setStage('uploading');
      const upRes = await fetch('/api/storage/upload-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId, filename: file.name, contentType: compressed.mimeType,
          dataBase64: compressed.dataBase64, tenantId,
        }),
      });
      let slipImageUrl: string | null = null;
      let slipSha256: string | null = null;
      if (upRes.ok) {
        const up = (await upRes.json()) as { slipImageUrl?: string; slipSha256?: string };
        slipImageUrl = up.slipImageUrl ?? null;
        slipSha256 = up.slipSha256 ?? null;
      }
      if (!live.current) return null;

      setStage('verifying');
      const data = slipImageUrl
        ? await postVerify({ orderId, slipImageUrl, tenantId, ...(slipSha256 ? { slipSha256 } : {}) })
        : await postVerify({ orderId, slipBase64: compressed.dataBase64, filename: file.name, contentType: compressed.mimeType, tenantId });
      if (!live.current) return null;
      setStage('done');
      const outcome = { ...data, compressedKb: compressed.fileSizeKb };
      setResult(data);
      setUiState('SUCCESS');
      return outcome;
    } catch (err) {
      if (!live.current) return null;
      setStage('idle');
      setError(friendlyError((err as Error).message));
      setUiState('ERROR');
      return null;
    }
  }, []);

  return { verifySlip, reset, stage, uiState, error, result, fileSizeKb };
}

export default useSlipVerification;
