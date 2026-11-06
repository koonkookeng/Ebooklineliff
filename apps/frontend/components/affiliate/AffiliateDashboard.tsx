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
    <div className="space-y-6">
      {/* KPI Overview */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl">
          <div className="text-xs text-muted-foreground uppercase">รายได้รวม</div>
          <div className="text-xl font-bold text-primary">฿{data.totalEarnings.toLocaleString('th-TH')}</div>
        </div>
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl">
          <div className="text-xs text-muted-foreground uppercase">รอรับ (Pending)</div>
          <div className="text-xl font-bold text-orange-600">฿{data.pendingEarnings.toLocaleString('th-TH')}</div>
        </div>
        <div className="p-3 bg-muted rounded-xl text-center">
          <div className="text-[10px] text-muted-foreground">Tier 1</div>
          <div className="font-bold">{data.tier1ReferralsCount} คน</div>
        </div>
        <div className="p-3 bg-muted rounded-xl text-center">
          <div className="text-[10px] text-muted-foreground">Tier 2</div>
          <div className="font-bold">{data.tier2ReferralsCount} คน</div>
        </div>
      </div>

      {/* Referral Tool */}
      <div className="p-4 border border-border rounded-2xl bg-card">
        <h3 className="font-bold mb-3 text-sm">รหัสแนะนำ / ลิงก์ส่วนตัว</h3>
        <div className="flex gap-2 mb-2">
          <code className="flex-1 p-2 bg-muted rounded-lg font-mono text-sm break-all">{data.affiliateCode}</code>
          <button 
            type="button" 
            onClick={() => void copyLink()}
            className="px-4 bg-primary text-white rounded-lg text-sm font-bold"
          >
            คัดลอก
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground italic">แชร์ลิงก์นี้ให้เพื่อน เมื่อเพื่อนซื้อสินค้าคุณจะได้รับคอมมิชชันทันที</p>
      </div>

      {/* Payout Form */}
      <form onSubmit={requestPayout} className="p-5 border border-border rounded-2xl bg-card space-y-4">
        <h3 className="font-bold">แจ้งถอนรายได้</h3>
        
        <div>
          <label className="text-xs text-muted-foreground block mb-1">จำนวนเงินที่ต้องการถอน (ขั้นต่ำ 100.-)</label>
          <input 
            type="number" 
            min={100} 
            value={amount} 
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            className="w-full p-3 bg-muted rounded-xl text-lg font-bold outline-primary"
          />
        </div>

        {/* Tax Preview */}
        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-sm space-y-1">
          <div className="flex justify-between">
            <span>ยอดถอน</span>
            <span>฿{amount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-red-500 text-xs">
            <span>หักภาษี ณ ที่จ่าย (3%)</span>
            <span>-฿{(amount * 0.03).toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-bold border-t border-blue-200 pt-1 mt-1">
            <span>รับสุทธิ</span>
            <span>฿{(amount * 0.97).toLocaleString()}</span>
          </div>
        </div>
        
        <div className="space-y-2">
          <input 
            placeholder="ชื่อธนาคาร" 
            value={bank.bankName} 
            onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} 
            required 
            className="w-full p-3 bg-muted rounded-xl text-sm outline-primary"
          />
          <input 
            placeholder="เลขบัญชีธนาคาร" 
            value={bank.bankAccountNumber} 
            onChange={(e) => setBank((b) => ({ ...b, bankAccountNumber: e.target.value }))} 
            required 
            className="w-full p-3 bg-muted rounded-xl text-sm outline-primary"
          />
          <input 
            placeholder="ชื่อบัญชี (ภาษาไทย/อังกฤษ)" 
            value={bank.bankAccountName} 
            onChange={(e) => setBank((b) => ({ ...b, bankAccountName: e.target.value }))} 
            required 
            className="w-full p-3 bg-muted rounded-xl text-sm outline-primary"
          />
        </div>

        <button 
          type="submit" 
          disabled={busy}
          className="w-full py-4 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50"
        >
          {busy ? 'กำลังส่งคำขอ...' : 'ยืนยันการถอนเงิน'}
        </button>
      </form>

      {msg && (
        <div className={`p-4 rounded-xl text-sm ${msg.startsWith('ERROR') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {msg}
        </div>
      )}
    </div>
  );
}
