// SSOT Phase 085 Task 7 — Admin KYC review console (manual override)
// Canonical: apps/frontend/app/(web)/admin/kyc/page.tsx
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface QueueRow {
  id: string;
  userId: string;
  status: string;
  createdAt: string;
}

async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`admin-kyc ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

function AdminKycInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminJson<QueueRow[]>(`/api/v1/admin/kyc/queue?tenant=${encodeURIComponent(slug)}`);
      setRows(data);
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(kycId: string, status: 'VERIFIED' | 'REJECTED' | 'ACTION_REQUIRED') {
    setBusyId(kycId);
    setMsg(null);
    try {
      const reason = status === 'REJECTED' ? window.prompt('เหตุผลปฏิเสธ (PDPA-actionable)') ?? '' : '';
      await adminJson(`/api/v1/admin/kyc/decide?tenant=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kycId, status, rejectionReason: reason || undefined }),
      });
      setMsg(`อัปเดต ${kycId} → ${status}`);
      await load();
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>ตรวจอนุมัติ e-KYC</h1>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <span>{r.userId}</span>
            <span>{r.status}</span>
            <button type="button" disabled={busyId === r.id} onClick={() => void decide(r.id, 'VERIFIED')}>
              อนุมัติ
            </button>
            <button type="button" disabled={busyId === r.id} onClick={() => void decide(r.id, 'ACTION_REQUIRED')}>
              ขอข้อมูลเพิ่ม
            </button>
            <button type="button" disabled={busyId === r.id} onClick={() => void decide(r.id, 'REJECTED')}>
              ปฏิเสธ
            </button>
          </li>
        ))}
        {rows.length === 0 && <li>ไม่มีคิวรอตรวจ</li>}
      </ul>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function AdminKycPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดคิวตรวจ…</p>}>
      <AdminKycInner />
    </Suspense>
  );
}
