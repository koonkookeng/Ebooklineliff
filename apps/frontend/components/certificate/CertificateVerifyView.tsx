// SSOT Phase 105 Task 7 — Public verify view (holographic badge + R2 PDF)
// Canonical: apps/frontend/components/certificate/CertificateVerifyView.tsx
// - 105-owned (048 CertificateViewCard untouched — different payload shape).
// - Reuses 048 CertificateVerificationBadge (valid/invalid/revoked/expired).
// - Zero-dep (inline SVG glyphs; no lucide/framer in public page).
'use client';

import React from 'react';
import type { CertificateVerificationPayload } from '@repo/shared';
import { CertificateVerificationBadge, type CertificateBadgeStatus } from './CertificateVerificationBadge';

function badgeOf(payload: CertificateVerificationPayload | null): CertificateBadgeStatus {
  if (!payload) return 'pending';
  if (payload.status === 'VERIFIED') return 'valid';
  if (payload.status === 'REVOKED') return 'revoked';
  if (payload.status === 'EXPIRED') return 'expired';
  return 'invalid';
}

function ShieldGlyph({ ok }: { ok: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l8 3.5v5.2c0 5-3.4 9.4-8 10.8-4.6-1.4-8-5.8-8-10.8V5.5L12 2z"
        fill={ok ? 'rgba(16,185,129,.15)' : 'rgba(244,63,94,.15)'}
        stroke={ok ? '#34d399' : '#fb7185'}
        strokeWidth="1.5"
      />
      <path
        d={ok ? 'M8.5 12.2l2.4 2.4 4.6-5' : 'M9 9l6 6M15 9l-6 6'}
        stroke={ok ? '#34d399' : '#fb7185'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CertificateVerifyView({
  payload,
  certificateNo,
  pdfBusy,
}: {
  payload: CertificateVerificationPayload | null;
  certificateNo: string;
  pdfBusy: boolean;
}) {
  const ok = payload?.success === true && payload.status === 'VERIFIED';
  const data = ok ? payload?.data : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl">
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

      <div
        className={`flex items-center gap-3 px-6 py-4 border-b ${
          ok ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-400' : 'border-rose-500/30 bg-rose-950/40 text-rose-400'
        }`}
      >
        <ShieldGlyph ok={ok} />
        <span className="font-semibold tracking-wide uppercase text-sm">
          {ok ? 'ใบรับรองได้รับการยืนยันถูกต้อง (OFFICIALLY VERIFIED)' : 'ไม่สามารถยืนยันใบรับรองนี้ได้ (UNVERIFIED)'}
        </span>
        <span className="ml-auto">
          <CertificateVerificationBadge status={badgeOf(payload)} size="sm" />
        </span>
      </div>

      <div className="p-6 sm:p-8 space-y-6">
        {ok && data ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
                  {data.student.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.student.avatarUrl} alt={data.student.studentName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold text-slate-300">{data.student.studentName.charAt(0)}</span>
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">{data.student.studentName}</h3>
                  <p className="text-xs text-slate-400">ผู้เรียนที่ผ่านการประเมินหลักสูตร</p>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <span className="inline-block px-3 py-1 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ID: {data.certificateNo}
                </span>
                <p className="text-xs text-slate-400 mt-1">ผู้ออกใบรับรอง: {data.issuer.tenantName}</p>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">ชื่อหลักสูตรที่สำเร็จการศึกษา</span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">
                {data.courseTitle}
              </h2>
              <div className="flex items-center gap-4 text-xs text-slate-400 pt-2">
                <span>ระยะเวลาเรียน: {data.totalHours} ชั่วโมง</span>
                <span>•</span>
                <span>วันที่ออกใบรับรอง: {new Date(data.issuedAt).toLocaleDateString('th-TH')}</span>
              </div>
            </div>

            <div className="pt-4 flex flex-wrap items-center gap-3">
              <a
                href={data.pdfDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-busy={pdfBusy}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium bg-emerald-500 hover:bg-emerald-600 text-slate-950 transition-colors shadow-lg shadow-emerald-500/20 text-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ดาวน์โหลด PDF ต้นฉบับ
              </a>
              <button
                type="button"
                onClick={() => {
                  const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
                  if (nav.share) void nav.share({ title: `ใบรับรอง ${data.student.studentName}`, url: window.location.href }).catch(() => undefined);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors text-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
                  <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" />
                  <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" stroke="currentColor" strokeWidth="2" />
                </svg>
                แชร์การรับรอง
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-12 space-y-4">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mx-auto">
              <path d="M12 3l10 18H2L12 3z" stroke="#fb7185" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M12 10v4.5" stroke="#fb7185" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="17.2" r="1" fill="#fb7185" />
            </svg>
            <h3 className="text-xl font-bold text-white">ไม่พบข้อมูลใบรับรองเลขที่ {certificateNo}</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {payload?.message || 'รหัสใบรับรองนี้อาจไม่ถูกต้อง หรือเอกสารอาจถูกดัดแปลงแก้ไข กรุณาตรวจสอบกับผู้เรียนหรือสถาบันผู้ออกใบรับรองอีกครั้ง'}
            </p>
          </div>
        )}
      </div>

      <div className="px-6 py-3 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
        <span>Verified by SDID Cryptographic Engine 144-XZ</span>
        <span>Checked at: {payload ? new Date(payload.scannedAt).toLocaleTimeString() : '-'}</span>
      </div>
    </div>
  );
}

export default CertificateVerifyView;
