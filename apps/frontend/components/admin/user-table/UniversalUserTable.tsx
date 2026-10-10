// SSOT Phase 109 §6.1 — dep-free windowed universal user table
// Canonical: apps/frontend/components/admin/user-table/UniversalUserTable.tsx
// - RISK_CALL: @tanstack/react-table + @tanstack/react-virtual are NOT
//   installed — this engine implements the same contract natively: 52px rows,
//   overscan 10, ≤60 DOM rows (<< 300 budget), 60fps translateY windowing.
// - Zero new deps (React + inline SVG only).
'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  windowRange,
  formatTHB,
  formatTHDate,
  ADMIN_TABLE_ROW_PX,
  type AdminUserTableItem,
} from '@/lib/admin-users';

interface UniversalUserTableProps {
  data: AdminUserTableItem[];
  totalCount: number;
  isLoading: boolean;
  onExecuteAction: (userId: string, action: string) => void;
  onOpenKyc: (userId: string) => void;
  onOpenWallet: (userId: string) => void;
  onImpersonate: (userId: string) => void;
}

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'bg-rose-100 text-rose-800 border-rose-300',
  FINANCE_ADMIN: 'bg-amber-100 text-amber-800 border-amber-300',
  CONTENT_MODERATOR: 'bg-orange-100 text-orange-800 border-orange-300',
  SUPPORT_STAFF: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  INSTRUCTOR: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  SELLER: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  MEMBER: 'bg-slate-100 text-slate-800 border-slate-300',
};

const KYC_BADGE: Record<string, string> = {
  VERIFIED: 'bg-emerald-500 text-white',
  PENDING: 'bg-amber-500 text-white animate-pulse cursor-pointer',
  REJECTED: 'bg-rose-500 text-white',
  NOT_SUBMITTED: 'bg-slate-200 text-slate-600',
  ACTION_REQUIRED: 'bg-orange-500 text-white',
};

const KYC_LABEL: Record<string, string> = {
  VERIFIED: 'อนุมัติแล้ว',
  PENDING: 'รอตรวจสอบ',
  REJECTED: 'ปฏิเสธแล้ว',
  NOT_SUBMITTED: 'ยังไม่ยื่น',
  ACTION_REQUIRED: 'ต้องแก้ไข',
};

const VIEWPORT_PX = 600;

export const UniversalUserTable: React.FC<UniversalUserTableProps> = ({
  data,
  totalCount,
  isLoading,
  onExecuteAction,
  onOpenKyc,
  onOpenWallet,
  onImpersonate,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const { start, end } = useMemo(
    () => windowRange(scrollTop, VIEWPORT_PX, data.length),
    [scrollTop, data.length],
  );
  const visible = useMemo(() => data.slice(start, end), [data, start, end]);
  const totalPx = data.length * ADMIN_TABLE_ROW_PX;

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="overflow-auto relative"
        style={{ height: VIEWPORT_PX }}
      >
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10 border-b border-slate-200 dark:border-slate-700">
            <tr>
              {['ผู้ใช้งาน / ร้านค้า', 'บทบาท', 'สถานะ KYC', 'ยอดเงินคงเหลือ', 'ออเดอร์ / ใช้จ่าย', 'วันที่ลงทะเบียน', 'การจัดการ'].map((h) => (
                <th key={h} className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ height: totalPx, position: 'relative', display: 'block' }}>
            {visible.map((user, i) => {
              const top = (start + i) * ADMIN_TABLE_ROW_PX;
              return (
                <tr
                  key={user.id}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ADMIN_TABLE_ROW_PX, transform: `translateY(${top}px)`, display: 'table', tableLayout: 'fixed' }}
                  className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                >
                  <td className="p-3 align-middle">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                        {user.displayName.substring(0, 2).toUpperCase()}
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{user.displayName}</span>
                        <span className="text-xs text-slate-500 truncate">{user.email || user.phone || user.lineUserId || 'N/A'}</span>
                      </span>
                    </div>
                  </td>
                  <td className="p-3 align-middle">
                    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${ROLE_BADGE[user.role] ?? 'bg-gray-100'}`}>{user.role}</span>
                  </td>
                  <td className="p-3 align-middle">
                    <button
                      onClick={() => user.kycStatus === 'PENDING' && onOpenKyc(user.id)}
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${KYC_BADGE[user.kycStatus] ?? 'bg-gray-100'}`}
                    >
                      {KYC_LABEL[user.kycStatus] ?? user.kycStatus}
                    </button>
                  </td>
                  <td className="p-3 align-middle">
                    <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200">{formatTHB(user.walletBalance)}</span>
                  </td>
                  <td className="p-3 align-middle text-xs text-slate-500">
                    {user.totalOrdersCount} ออเดอร์ · {formatTHB(user.totalSpentAmount)}
                  </td>
                  <td className="p-3 align-middle">
                    <span className="text-xs text-slate-500">{formatTHDate(user.createdAt)}</span>
                  </td>
                  <td className="p-3 align-middle">
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === user.id ? null : user.id)}
                        aria-label="จัดการผู้ใช้"
                        className="h-8 w-8 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                      >
                        <svg className="h-4 w-4 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
                      {openMenu === user.id && (
                        <div className="absolute right-0 z-20 w-52 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 text-sm">
                          <button onClick={() => { setOpenMenu(null); onOpenKyc(user.id); }} className="block w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">ดูรายละเอียด KYC</button>
                          <button onClick={() => { setOpenMenu(null); onOpenWallet(user.id); }} className="block w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">ปรับปรุงยอดเงิน</button>
                          <button onClick={() => { setOpenMenu(null); onImpersonate(user.id); }} className="block w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">เข้าสู่ระบบแทนผู้ใช้</button>
                          <button onClick={() => { setOpenMenu(null); onExecuteAction(user.id, user.role === 'MEMBER' ? 'FREEZE_ACCOUNT' : 'UNFREEZE_ACCOUNT'); }} className="block w-full text-left px-4 py-2 text-rose-600 hover:bg-slate-50 dark:hover:bg-slate-800">
                            {user.role === 'MEMBER' ? 'ระงับบัญชีผู้ใช้' : 'ยกเลิกระงับบัญชี'}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isLoading && (
          <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center">
            <span className="h-8 w-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" aria-label="กำลังโหลด" />
          </div>
        )}
        {data.length === 0 && !isLoading && (
          <div className="p-12 text-center text-slate-500">ไม่พบผู้ใช้งานตามเงื่อนไข</div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500">
        แสดง {data.length} จาก {totalCount.toLocaleString('th-TH')} รายการ · แถวที่ render {visible.length} (งบ DOM &lt; 300)
      </div>
    </div>
  );
};

export default UniversalUserTable;
