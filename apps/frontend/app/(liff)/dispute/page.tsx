// SSOT Phase 113 §2/§6 — LIFF dispute center (form + escrow + timeline)
// Canonical: apps/frontend/app/(liff)/dispute/page.tsx
// - LIFF_INIT (splash) -> IDLE (form/dashboard) -> LOADING (compress/submit)
//   -> SUCCESS (timeline badge) / ERROR (banner + code + retry).
//   Drafts + snapshots survive offline via IndexedDB (§2.1).
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DisputeFilingForm } from '@/components/dispute/DisputeFilingForm';
import { EscrowStatusCard } from '@/components/dispute/EscrowStatusCard';
import { disputeApi, type DisputeDetailView, type DisputeUiState, type EscrowStatusView } from '@/lib/dispute/dispute-client';

function DisputeCenterInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const orderId = params.get('orderId') ?? '';
  const netAmount = Number(params.get('netAmount') ?? 0);
  const [state, setState] = useState<DisputeUiState>('LIFF_INIT');
  const [escrow, setEscrow] = useState<EscrowStatusView | null>(null);
  const [dispute, setDispute] = useState<DisputeDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) {
      setError('ไม่พบ orderId');
      setErrorCode('DISPUTE_NO_ORDER');
      setState('ERROR');
      return;
    }
    try {
      const [e, d] = await Promise.all([
        disputeApi(tenant).escrowStatus(orderId).catch(() => null),
        disputeApi(tenant).disputeByOrder(orderId).catch(() => null),
      ]);
      setEscrow(e);
      setDispute(d);
      setState('IDLE');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      setErrorCode('DISPUTE_LOAD_FAILED');
      setState('ERROR');
    }
  }, [tenant, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(body: { orderId: string; reason: string; description: string; evidenceImageUrls: string[]; requestedRefundAmount: number }): Promise<void> {
    setBusy(true);
    setState('LOADING');
    setError(null);
    setErrorCode(null);
    try {
      await disputeApi(tenant).fileClaim(body);
      setState('SUCCESS');
      await load();
      setState('IDLE');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ส่งข้อพิพาทไม่สำเร็จ';
      setError(message);
      setErrorCode(message.includes('7 วัน') ? 'DISPUTE_WINDOW_EXPIRED' : 'DISPUTE_SUBMIT_FAILED');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  // Evidence blobs are staged for the R2 vault lane (presigned PUT issued
  // by the media-vault lane — Zero Redundant: no second uploader here).
  // This stub resolves a vault URL synchronously for wiring/tests.
  async function stageEvidence(blob: Blob): Promise<string> {
    void blob;
    return `https://vault.local/dispute/${orderId}/${Date.now().toString(36)}.jpg`;
  }

  if (state === 'LIFF_INIT') return <p>กำลังโหลดศูนย์ข้อพิพาท…</p>;

  return (
    <div>
      <h1>ข้อพิพาท & Escrow Protection</h1>
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{errorCode ? ` [${errorCode}]` : ''}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      {state === 'LOADING' && <p>กำลังบีบอัด/ส่งข้อมูล…</p>}
      <EscrowStatusCard escrow={escrow} dispute={dispute} />
      {!dispute && (state === 'IDLE' || state === 'ERROR') && (
        <DisputeFilingForm orderId={orderId} netAmount={netAmount} busy={busy} error={state === 'ERROR' ? error : null} onSubmit={submit} onCompressed={stageEvidence} />
      )}
      {dispute && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            disputeApi(tenant)
              .cancelClaim(dispute.id)
              .then(() => load())
              .catch((err: Error) => {
                setError(err.message);
                setErrorCode('DISPUTE_CANCEL_FAILED');
              })
              .finally(() => setBusy(false));
          }}
        >
          <button type="submit" disabled={busy || dispute.status === 'CANCELLED_BY_BUYER'}>
            ยกเลิกข้อพิพาท (คืนสถานะพักเงิน)
          </button>
        </form>
      )}
    </div>
  );
}

export default function LiffDisputeCenterPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์ข้อพิพาท…</p>}>
      <DisputeCenterInner />
    </Suspense>
  );
}
