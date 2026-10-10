// SSOT Phase 109 §6 — central admin users console page
// Canonical: apps/frontend/app/(admin)/admin/users/page.tsx
// States: ADMIN_INIT (skeleton) → IDLE → LOADING (overlay) → SUCCESS (toast +
// optimistic update) / ERROR (banner + retry). Ctrl/Cmd+K focuses search,
// Esc closes drawers. Zero new deps.
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UniversalUserTable } from '@/components/admin/user-table/UniversalUserTable';
import { KycInspectionDrawer } from '@/components/admin/kyc-modal/KycInspectionDrawer';
import { WalletAdjustModal } from '@/components/admin/user-table/WalletAdjustModal';
import {
  fetchAdminUsers,
  executeAdminAction,
  type AdminUserTableItem,
} from '@/lib/admin-users';

type PageState = 'ADMIN_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const ROLE_OPTIONS = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF', 'INSTRUCTOR', 'SELLER', 'MEMBER'];
const KYC_OPTIONS = ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'ACTION_REQUIRED'];

interface Stats {
  totalUsers: number;
  totalSellers: number;
  totalInstructors: number;
  pendingKYCCount: number;
  totalWalletCirculation: number;
}

export default function AdminUsersPage() {
  const [state, setState] = useState<PageState>('ADMIN_INIT');
  const [items, setItems] = useState<AdminUserTableItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ searchKeyword: '', role: [] as string[], kycStatus: [] as string[], minWalletBalance: '' });
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [kycUserId, setKycUserId] = useState<string | null>(null);
  const [walletUserId, setWalletUserId] = useState<string | null>(null);
  const [impersonateUserId, setImpersonateUserId] = useState<string | null>(null);
  const [impReason, setImpReason] = useState('');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (overrides?: Partial<typeof filters>, nextPage?: number) => {
    const f = { ...filters, ...overrides };
    const p = nextPage ?? page;
    setState((s) => (s === 'ADMIN_INIT' ? s : 'LOADING'));
    try {
      const res = await fetchAdminUsers({
        searchKeyword: f.searchKeyword || undefined,
        role: f.role.length ? (f.role as never[]) : undefined,
        kycStatus: f.kycStatus.length ? (f.kycStatus as never[]) : undefined,
        minWalletBalance: f.minWalletBalance ? Number(f.minWalletBalance) : undefined,
        page: p,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      setItems(res.items);
      setTotal(res.totalCount);
      setTotalPages(res.totalPages);
      setStats(res.summaryStats);
      setState('IDLE');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
      setState('ERROR');
    }
  }, [filters, page]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setKycUserId(null);
        setWalletUserId(null);
        setImpersonateUserId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flashSuccess = (msg: string) => {
    setToast(msg);
    setState('SUCCESS');
    window.setTimeout(() => setState('IDLE'), 2000);
  };

  const runAction = async (userId: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const reason = (extra?.['reason'] as string) ?? 'ดำเนินการผ่าน Admin Console';
      await executeAdminAction({ userId, action, reason, ...extra });
      flashSuccess(`ดำเนินการ ${action} สำเร็จ`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  };

  const toggleList = (key: 'role' | 'kycStatus', value: string) => {
    const next = filters[key].includes(value)
      ? filters[key].filter((v) => v !== value)
      : [...filters[key], value];
    const nf = { ...filters, [key]: next };
    setFilters(nf);
    setPage(1);
    load({ [key]: next }, 1);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">จัดการผู้ใช้ &amp; ผู้ขาย</h1>
          <p className="text-slate-600 dark:text-slate-400">Universal User &amp; Merchant Management · รองรับ 1M+ รายการ</p>
        </div>

        {state === 'ADMIN_INIT' ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 animate-pulse" aria-busy="true">
            <div className="grid grid-cols-5 gap-4 mb-6">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded" />)}</div>
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded mb-2" />)}
          </div>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                {[
                  ['ผู้ใช้ทั้งหมด', stats.totalUsers],
                  ['ผู้ขาย', stats.totalSellers],
                  ['ผู้สอน', stats.totalInstructors],
                  ['KYC รอตรวจ', stats.pendingKYCCount],
                  ['เงินหมุนเวียน (฿)', Math.round(stats.totalWalletCirculation)],
                ].map(([label, v]) => (
                  <div key={label as string} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-2xl font-bold">{(v as number).toLocaleString('th-TH')}</p>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 flex items-center gap-3" role="alert">
                <span className="flex-1 text-sm">{error}</span>
                <button onClick={() => load()} className="px-3 py-1.5 text-sm rounded bg-rose-600 text-white">Retry Fetching Data</button>
              </div>
            )}
            {toast && state === 'SUCCESS' && (
              <div className="mb-4 p-4 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-sm" role="status">{toast}</div>
            )}

            <div className="mb-4 flex flex-wrap gap-3 items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <input
                ref={searchRef}
                value={filters.searchKeyword}
                onChange={(e) => setFilters({ ...filters, searchKeyword: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(undefined, 1); } }}
                placeholder="ค้นหา ชื่อ / อีเมล / เบอร์ / LINE ID (Ctrl+K)"
                className="flex-1 min-w-[220px] px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800"
              />
              <input
                value={filters.minWalletBalance}
                onChange={(e) => setFilters({ ...filters, minWalletBalance: e.target.value })}
                inputMode="decimal"
                placeholder="Wallet ขั้นต่ำ"
                className="w-32 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800"
              />
              <button
                onClick={() => { setPage(1); load(undefined, 1); }}
                className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                ค้นหา
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => toggleList('role', r)}
                  className={`px-3 py-1 rounded-full border text-xs ${filters.role.includes(r) ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="mb-6 flex flex-wrap gap-2">
              {KYC_OPTIONS.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleList('kycStatus', k)}
                  className={`px-3 py-1 rounded-full border text-xs ${filters.kycStatus.includes(k) ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}
                >
                  {k}
                </button>
              ))}
            </div>

            <UniversalUserTable
              data={items}
              totalCount={total}
              isLoading={state === 'LOADING'}
              onExecuteAction={(uid, action) => {
                if (action === 'FREEZE_ACCOUNT' || action === 'UNFREEZE_ACCOUNT') {
                  runAction(uid, action, { reason: action === 'FREEZE_ACCOUNT' ? 'ระงับบัญชีผ่าน Admin Console' : 'ยกเลิกระงับผ่าน Admin Console' });
                }
              }}
              onOpenKyc={setKycUserId}
              onOpenWallet={setWalletUserId}
              onImpersonate={setImpersonateUserId}
            />

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-slate-500">หน้า {page} / {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); load(undefined, p); }} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50">ก่อนหน้า</button>
                <button disabled={page >= totalPages} onClick={() => { const p = page + 1; setPage(p); load(undefined, p); }} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50">ถัดไป</button>
              </div>
            </div>
          </>
        )}

        <KycInspectionDrawer
          userId={kycUserId}
          onClose={() => setKycUserId(null)}
          busy={busy}
          onApprove={(uid) => runAction(uid, 'APPROVE_KYC', { reason: 'KYC ตรวจสอบผ่าน Admin Console' }).then(() => setKycUserId(null))}
          onReject={(uid, reason) => runAction(uid, 'REJECT_KYC', { reason: `ปฏิเสธ KYC: ${reason}`, rejectionReason: reason }).then(() => setKycUserId(null))}
        />

        <WalletAdjustModal
          userId={walletUserId}
          onClose={() => setWalletUserId(null)}
          busy={busy}
          onSubmit={(uid, amount, reason) =>
            runAction(uid, 'ADJUST_WALLET', { walletAdjustmentAmount: amount, reason }).then(() => setWalletUserId(null))
          }
        />

        {impersonateUserId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="เข้าสู่ระบบแทนผู้ใช้">
            <div className="absolute inset-0 bg-black/50" onClick={() => setImpersonateUserId(null)} />
            <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6">
              <h2 className="text-lg font-bold">เข้าสู่ระบบแทนผู้ใช้</h2>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                โทเค็นอายุ 15 นาที · ห้ามถอนเงิน/เปลี่ยนรหัสผ่าน · ทุกการกระทำถูกบันทึก Audit Log
              </p>
              <textarea
                value={impReason}
                onChange={(e) => setImpReason(e.target.value)}
                rows={3}
                placeholder="เหตุผลด้าน support (≥ 5 ตัวอักษร)"
                className="mt-3 w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-800"
              />
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setImpersonateUserId(null)} className="px-5 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800">ยกเลิก</button>
                <button
                  disabled={busy || impReason.trim().length < 5}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const out = await executeAdminAction({ userId: impersonateUserId, action: 'GENERATE_IMPERSONATION_TOKEN', reason: impReason.trim() }) as { impersonationToken?: string };
                      if (out.impersonationToken) {
                        sessionStorage.setItem('admin-impersonation-ticket', String(out.impersonationToken));
                        flashSuccess('ออกโทเค็น impersonation แล้ว (15 นาที)');
                      }
                      setImpersonateUserId(null);
                      setImpReason('');
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'ออกโทเค็นไม่สำเร็จ');
                      setState('ERROR');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-5 py-2 text-sm text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  ออกโทเค็น
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
