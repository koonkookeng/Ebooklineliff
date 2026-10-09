// SSOT Phase 085 §2.2 — KYC wizard hook (3-step + 5-state machine)
// Canonical: apps/frontend/hooks/useKycWizard.ts
// - Steps: 1 ID card (+laser) → 2 selfie → 3 bank account. Each image is
//   watermarked + compressed + vault-uploaded before submit (<2MB, Gate 5).
// - Zero-dep beyond the kyc client/watermarker.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { kycApi, uploadToVault, type KycStatus, type KycStatusResponse, type KycSubmitResponse } from '../lib/kyc/kyc-client';
import { applyKycWatermark, shortUserHash } from '../lib/kyc/kyc-watermark';

export type KycStep = 1 | 2 | 3;

export function useKycWizard(slug: string, tenantName: string, userId: string) {
  const [status, setStatus] = useState<KycStatus>('LIFF_INIT');
  const [step, setStep] = useState<KycStep>(1);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<KycStatusResponse | null>(null);
  const [result, setResult] = useState<KycSubmitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const s = await kycApi(slug).status();
      setCurrent(s);
      setStatus('IDLE');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, nonce]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadDocument(kind: 'id-card' | 'selfie' | 'bookbank', file: File): Promise<string> {
    setBusy(true);
    setError(null);
    try {
      const marked = await applyKycWatermark(file, tenantName, shortUserHash(userId));
      const ticket = await kycApi(slug).presign(kind);
      await uploadToVault(ticket.uploadUrl, marked);
      return ticket.objectKey;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function submit(form: Record<string, string>): Promise<KycSubmitResponse> {
    setStatus('LOADING');
    setError(null);
    try {
      const r = await kycApi(slug).submit(form);
      setResult(r);
      setStatus('SUCCESS');
      void refresh();
      return r;
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
      throw e;
    }
  }

  return {
    status,
    step,
    setStep,
    error,
    current,
    result,
    busy,
    uploadDocument,
    submit,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
