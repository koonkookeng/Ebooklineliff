// SSOT Phase 079 §2.2 — Affiliate earnings dashboard (dep-free, <30MB)
// Canonical: apps/frontend/components/affiliate/AffiliateDashboard.tsx
// - Earnings cards + referral link copy + payout request form (100 THB
//   floor, 3% split preview); no charts lib (text KPIs keep RAM <30MB).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { affiliateApi, cacheAffiliateCode, type AffiliateDashboard as Dashboard } from '../../lib/affiliate/affiliate-client';

export function AffiliateDashboard({ slug, initial }: { slug: string; initial: Dashboard }) {
  const [data] = useState<Dashboard>(initial);
  const [amount, setAmount] = useState(100);
  const [bank, setBank] = useState({ bankName: '', bankAccountNumber: '', bankAccountName: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function copyLink() {
    await navigator.clipboard.writeText(data.referralLink || data.affiliateCode).catch(() => undefined);
    cacheAffiliateCode(data.affiliateCode);
    setMsg('คัดลอกลิงก์ช่วยขายแล้ว!');
  }

  async function requestPayout(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await affiliateApi(slug).payout({ amount, ...bank });
      setMsg(`ขอถอน ${res.requestedAmount} บาท (หักภาษี ${res.taxWithheld3Percent} รับสุทธิ ${res.netPayoutAmount}) สถานะ ${res.status}`);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="merchant-form" style={{ flexDirection: 'row' }}>
        <div>รายได้รวม: ฿{data.totalEarnings.toLocaleString('th-TH')}</div>
        <div>รอรับ: ฿{data.pendingEarnings.toLocaleString('th-TH')}</div>
        <div>Tier1: {data.tier1ReferralsCount} · Tier2: {data.tier2ReferralsCount}</div>
      </div>
      <div className="merchant-form" style={{ flexDirection: 'row' }}>
        <code>{data.affiliateCode}</code>
        <button type="button" onClick={() => void copyLink()}>คัดลอกลิงก์</button>
      </div>
      <form onSubmit={requestPayout} className="merchant-form">
        <input type="number" min={100} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
        <input placeholder="ธนาคาร" value={bank.bankName} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} required />
        <input placeholder="เลขบัญชี (≥10 หลัก)" value={bank.bankAccountNumber} onChange={(e) => setBank((b) => ({ ...b, bankAccountNumber: e.target.value }))} required />
        <input placeholder="ชื่อบัญชี" value={bank.bankAccountName} onChange={(e) => setBank((b) => ({ ...b, bankAccountName: e.target.value }))} required />
        <button type="submit" disabled={busy}>{busy ? 'กำลังขอถอน…' : 'ขอถอนเงิน (หักภาษี 3%)'}</button>
      </form>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
