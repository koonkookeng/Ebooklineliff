// SSOT Phase 082 Task 6 — "ศูนย์ภาษีและเอกสาร 50 ทวิ ของฉัน" (5-state)
// Canonical: apps/frontend/app/(liff)/tax/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTaxCenter } from '../../../hooks/useTaxCenter';
import { TaxSummaryCard } from '../../../components/tax/TaxSummaryCard';
import { TawiCertificateCard } from '../../../components/tax/TawiCertificateCard';
import { taxApi } from '../../../lib/tax/tax-client';

function TaxCenterInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const year = Number(params.get('year')) || new Date().getFullYear();
  const { status, error, summary, certificates, retry } = useTaxCenter(slug, year);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setProfileMsg(null);
    try {
      const res = await fetch(`/api/v1/tax/profile?tenant=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerType: String(fd.get('payerType') || 'INDIVIDUAL'),
          taxId: String(fd.get('taxId') || ''),
          fullNameOrCompanyName: String(fd.get('name') || ''),
          address: String(fd.get('address') || ''),
        }),
      });
      if (!res.ok) throw new Error(`profile ${res.status}`);
      setProfileMsg('บันทึกข้อมูลภาษีแล้ว');
      retry();
    } catch (err) {
      setProfileMsg(`ERROR: ${(err as Error).message}`);
    }
  }

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return <p>กำลังออกใบ 50 ทวิ…</p>;
  }

  if (status === 'ERROR' || (!summary && certificates.length === 0)) {
    return (
      <div>
        <p role="alert">
          {error ?? 'กรุณาอัปเดตข้อมูลบัตรประชาชน/เลขผู้เสียภาษี'}
        </p>
        <form onSubmit={saveProfile}>
          <select name="payerType" defaultValue="INDIVIDUAL">
            <option value="INDIVIDUAL">บุคคลธรรมดา</option>
            <option value="JURISTIC_PERSON">นิติบุคคล</option>
          </select>
          <input name="taxId" placeholder="เลขผู้เสียภาษี 13 หลัก" required minLength={10} maxLength={13} />
          <input name="name" placeholder="ชื่อ-นามสกุล / บริษัท" required minLength={2} />
          <input name="address" placeholder="ที่อยู่" required minLength={5} />
          <button type="submit">แก้ไขข้อมูล</button>
        </form>
        {profileMsg && <p role="status">{profileMsg}</p>}
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>ศูนย์ภาษีของฉัน</h1>
      {summary && <TaxSummaryCard summary={summary} />}
      {certificates.map((c) => (
        <TawiCertificateCard key={c.id} slug={slug} cert={c} />
      ))}
      {certificates.length === 0 && <p>ยังไม่มีใบ 50 ทวิ — เอกสารจะออกอัตโนมัติเมื่อมีการถอนเงิน</p>}
      <button
        type="button"
        onClick={() => {
          void taxApi(slug).summary(year).catch(() => null);
          retry();
        }}
      >
        รีเฟรช
      </button>
    </div>
  );
}

export default function LiffTaxPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์ข้อมูลภาษี…</p>}>
      <TaxCenterInner />
    </Suspense>
  );
}
