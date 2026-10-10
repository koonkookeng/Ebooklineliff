// SSOT Phase 120 §6.1 — unusual activity sheet (dep-free, <30MB)
// Canonical: apps/frontend/components/security/login-history-modal.tsx
// (legacy src/frontend/components/security/login-history-modal.tsx — the
// file shipped as a 120-owned Placeholder; siblings login-history-modal
// neighbors (masked-field, PdpaConsentModal) are untouched.)
// - Presentational sheet: location/IP/device/risk + [block session] /
//   [verify self]. No lucide (text glyphs), no tanstack. Zero new deps.
'use client';

import React, { useState } from 'react';

export interface UnusualActivity {
  location: string;
  ipAddress: string;
  device: string;
  riskLevel: 'HIGH' | 'CRITICAL';
}

export function UnusualActivitySheet(props: {
  activity: UnusualActivity;
  busy: boolean;
  onBlockSession: () => Promise<unknown>;
  onVerifySelf: () => void;
}) {
  const { activity, busy, onBlockSession, onVerifySelf } = props;
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  async function handleBlock() {
    setIsProcessing(true);
    try {
      await onBlockSession();
      setIsBlocked(true);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div data-testid="unusual-activity-sheet" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, borderRadius: '16px 16px 0 0', padding: 24 }}>
      <h3>แจ้งเตือนกิจกรรมเข้าสู่ระบบผิดปกติ</h3>
      <p data-testid="activity-risk">ตรวจพบการล็อกอินสุ่มเสี่ยงระดับ {activity.riskLevel}</p>
      <dl>
        <div>
          <dt>ตำแหน่ง:</dt>
          <dd data-testid="activity-location">{activity.location}</dd>
        </div>
        <div>
          <dt>IP Address:</dt>
          <dd data-testid="activity-ip">{activity.ipAddress}</dd>
        </div>
        <div>
          <dt>อุปกรณ์:</dt>
          <dd>{activity.device}</dd>
        </div>
      </dl>
      {isBlocked ? (
        <p role="status" data-testid="activity-blocked">
          ระงับเซสชันที่ผิดปกติเรียบร้อยแล้ว
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button type="button" onClick={() => void handleBlock()} disabled={isProcessing || busy}>
            {isProcessing ? 'กำลังบล็อก…' : 'บล็อกเซสชันนี้'}
          </button>
          <button type="button" onClick={onVerifySelf}>
            ใช่ ฉันเอง
          </button>
        </div>
      )}
    </div>
  );
}

export interface LoginHistoryEntry {
  id: string;
  ipAddress: string;
  city: string | null;
  countryCode: string | null;
  riskLevel: string;
  riskScore: number;
  anomalyType: string;
  createdAt: string;
}

export function LoginHistoryModal(props: { entries: LoginHistoryEntry[]; onClose: () => void }) {
  const { entries, onClose } = props;
  return (
    <div role="dialog" aria-label="ประวัติการเข้าใช้งาน">
      <h3>ประวัติการเข้าใช้งาน</h3>
      {entries.length === 0 && <p>ยังไม่มีประวัติ</p>}
      <ul>
        {entries.map((e) => (
          <li key={e.id} data-testid="login-row" data-risk={e.riskLevel}>
            {e.ipAddress} · {e.city ?? '—'} ({e.countryCode ?? '—'}) · {e.anomalyType} · เสี่ยง {e.riskScore}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose}>
        ปิด
      </button>
    </div>
  );
}
