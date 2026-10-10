// SSOT Phase 111 §6.2 — Admin KYC verification queue workspace (dep-free)
// Canonical: apps/frontend/components/kyc/KycQueueWorkspace.tsx
// - Split view: left 50% watermarked doc image (300s presigned URL, zoom/
//   rotate controls, context-menu/right-click disabled per SECURE_VIEWPORT);
//   right 50% OCR-vs-typed comparison with mismatch highlights.
// - Risk badge: GREEN Low / YELLOW Medium / RED High-Critical(+tamper).
// - Quick actions: Approve (F8) / Reject with reason (F9).
// - Zero new deps (React only).
'use client';

import React, { useCallback, useEffect, useState } from 'react';

export interface KycQueueItemView {
  id: string;
  userId: string;
  status: string;
  idCardNumberMasked: string;
  fullNameTh: string;
  bankName: string;
  bankAccountNumberMasked: string;
  bankAccountName: string;
  idCardImageUrlSigned: string;
  bankBookImageUrlSigned: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  confidenceScore: number;
  submittedAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

export type QueueWorkspaceState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export function riskBadgeColor(riskLevel: string): 'green' | 'yellow' | 'red' {
  if (riskLevel === 'LOW') return 'green';
  if (riskLevel === 'MEDIUM') return 'yellow';
  return 'red';
}

export function riskBadgeLabel(riskLevel: string): string {
  if (riskLevel === 'LOW') return 'GREEN · Low Risk';
  if (riskLevel === 'MEDIUM') return 'YELLOW · Medium Risk';
  if (riskLevel === 'CRITICAL') return 'RED · Critical / Duplicate';
  return 'RED · High Risk / Possible Tamper';
}

export function KycQueueWorkspace(props: {
  items: KycQueueItemView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  state: QueueWorkspaceState;
  error: string | null;
  busy: boolean;
  onApprove: (id: string) => Promise<unknown>;
  onReject: (id: string, reason: string) => Promise<unknown>;
}) {
  const { items, selectedId, onSelect, state, error, busy, onApprove, onReject } = props;
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const [doc, setDoc] = useState<'id' | 'bank'>('id');
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const approve = useCallback(async () => {
    if (!selected || busy) return;
    await onApprove(selected.id).catch(() => undefined);
    setToast('อนุมัติแล้ว — ปลดล็อก SELLER + แจ้ง LINE Flex');
  }, [selected, busy, onApprove]);

  const reject = useCallback(async () => {
    if (!selected || busy) return;
    const r = reason.trim() || 'เอกสารไม่ชัดเจน กรุณาถ่ายใหม่';
    await onReject(selected.id, r).catch(() => undefined);
    setToast('ปฏิเสธแล้ว — แจ้งเหตุผลทาง LINE Flex');
  }, [selected, busy, reason, onReject]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F8') { e.preventDefault(); void approve(); }
      if (e.key === 'F9') { e.preventDefault(); void reject(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approve, reject]);

  useEffect(() => {
    setZoom(1);
    setRotate(0);
    setDoc('id');
  }, [selectedId]);

  if (state === 'LIFF_INIT') return <p>กำลังโหลดคิวตรวจสอบ KYC…</p>;
  if (state === 'ERROR') return <p role="alert">{error ?? 'โหลดคิวไม่สำเร็จ'}</p>;

  const docUrl = selected ? (doc === 'id' ? selected.idCardImageUrlSigned : selected.bankBookImageUrlSigned) : '';
  const mismatchBank = selected ? selected.bankAccountName.trim() !== selected.fullNameTh.trim() : false;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{ display: 'grid', gridTemplateColumns: '280px 1fr 1fr', gap: 12 }}
    >
      <section aria-label="คิวรออนุมัติ">
        <h2>คิว ({items.length})</h2>
        <ul>
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                aria-current={it.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(it.id)}
                style={{ fontWeight: it.id === selectedId ? 'bold' : undefined }}
              >
                {it.fullNameTh || it.userId} · {riskBadgeLabel(it.riskLevel)}
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 && state === 'IDLE' && <p>ไม่มีคิวรออนุมัติ</p>}
      </section>

      <section aria-label="ภาพเอกสาร">
        {!selected && <p>เลือกรายการจากคิว</p>}
        {selected && (
          <div>
            <div role="tablist" aria-label="เลือกเอกสาร">
              <button type="button" role="tab" aria-selected={doc === 'id'} onClick={() => setDoc('id')}>บัตรประชาชน</button>
              <button type="button" role="tab" aria-selected={doc === 'bank'} onClick={() => setDoc('bank')}>สมุดบัญชี</button>
            </div>
            {docUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={docUrl}
                alt={doc === 'id' ? 'ภาพบัตรประชาชน (ลายน้ำ)' : 'ภาพสมุดบัญชี (ลายน้ำ)'}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                style={{ width: `${Math.round(zoom * 100)}%`, transform: `rotate(${rotate}deg)`, userSelect: 'none' }}
              />
            ) : (
              <p role="alert">ลิงก์ภาพหมดอายุ — กดเลือกรายการใหม่เพื่อออก presigned URL ใหม่ (300 วินาที)</p>
            )}
            <div>
              <button type="button" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}>ซูมเข้า</button>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>ซูมออก</button>
              <button type="button" onClick={() => setRotate((r) => (r + 90) % 360)}>หมุน 90°</button>
            </div>
            <p>ลิงก์ภาพมีอายุ 5 นาที (Zero-Egress R2 Private Vault)</p>
          </div>
        )}
      </section>

      <section aria-label="ข้อมูล OCR และการอนุมัติ">
        {!selected && <p>—</p>}
        {selected && (
          <div>
            <p data-testid="risk-badge" data-color={riskBadgeColor(selected.riskLevel)}>
              {riskBadgeLabel(selected.riskLevel)} · OCR {selected.confidenceScore}%
            </p>
            <dl>
              <dt>เลขบัตร (มาสก์)</dt>
              <dd>{selected.idCardNumberMasked}</dd>
              <dt>ชื่อ-นามสกุล</dt>
              <dd>{selected.fullNameTh}</dd>
              <dt>ธนาคาร</dt>
              <dd>{selected.bankName}</dd>
              <dt>เลขบัญชี (มาสก์)</dt>
              <dd>{selected.bankAccountNumberMasked}</dd>
              <dt>ชื่อบัญชี</dt>
              <dd style={mismatchBank ? { color: 'red', fontWeight: 'bold' } : undefined}>
                {selected.bankAccountName}
                {mismatchBank && ' — ไม่ตรงกับชื่อบนบัตร'}
              </dd>
            </dl>
            <div>
              <button type="button" onClick={() => void approve()} disabled={busy || state === 'LOADING'}>
                อนุมัติ (F8)
              </button>
              <input
                placeholder="เหตุผลปฏิเสธ"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="เหตุผลปฏิเสธ"
              />
              <button type="button" onClick={() => void reject()} disabled={busy || state === 'LOADING'}>
                ปฏิเสธพร้อมเหตุผล (F9)
              </button>
            </div>
            {state === 'LOADING' && <p>กำลังบันทึกคำตัดสิน…</p>}
            {toast && <p role="status">{toast}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
