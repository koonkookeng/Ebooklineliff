// SSOT Phase 032 Task 7 — LIFF shipping address (GPS autofill + local draft)
// Canonical: apps/frontend/app/(liff)/checkout/address/page.tsx
// (legacy src/frontend/app/(liff)/checkout/address/page.tsx)
// - BDD Scenario 2: “ใช้ตำแหน่งปัจจุบัน” → GEOLOCATION sheet (PDPA) →
//   getCurrentPosition (10s, low power) → reverse-geocode proxy → autofill
//   subdistrict/district/province/postalCode (< 800ms on cache hit).
// - Gate 4 (PDPA): the form keeps district-level fields only; raw lat/lng is
//   used for the lookup and never persisted — the draft (localStorage) carries
//   address text alone.
// - Draft key namespaced per tenant; manual edits always win over autofill.
'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PermissionDialog } from '../../../../components/permissions/PermissionDialog';
import { reverseGeocode } from '../../../../lib/permissions/permission-client';
import type { GrantedCoords } from '../../../../hooks/useDevicePermissions';

interface AddressDraft {
  name: string;
  phone: string;
  addressLine: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

const EMPTY: AddressDraft = { name: '', phone: '', addressLine: '', subdistrict: '', district: '', province: '', postalCode: '' };

function draftKey(tenant: string): string {
  return `address-draft:${tenant}`;
}

function AddressInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const tenantName = params.get('tenantName') ?? 'แพลตฟอร์ม';
  const [draft, setDraft] = useState<AddressDraft>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const lastCoords = React.useRef<GrantedCoords | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(tenant));
      if (raw) setDraft({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      // No draft yet.
    }
  }, [tenant]);

  const set = (patch: Partial<AddressDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const fillFromCoords = async (coords: GrantedCoords) => {
    lastCoords.current = coords;
    setLocating(true);
    setGeoError(null);
    const result = await reverseGeocode(coords.latitude, coords.longitude);
    setLocating(false);
    if (!result) {
      setGeoError('ค้นหาที่อยู่จากพิกัดไม่สำเร็จ กรุณากรอกเอง');
      return;
    }
    set({ subdistrict: result.subdistrict, district: result.district, province: result.province, postalCode: result.postalCode });
  };

  const save = () => {
    try {
      localStorage.setItem(draftKey(tenant), JSON.stringify(draft));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  const input = (label: string, field: keyof AddressDraft, placeholder: string, readOnly = false) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        value={draft[field]}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => set({ [field]: e.target.value })}
        className="rounded-xl border border-slate-200 px-3 py-2"
      />
    </label>
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
      <h1 className="text-lg font-bold">ที่อยู่จัดส่ง</h1>

      <PermissionDialog
        permissionType="GEOLOCATION"
        purpose={`shipping address autofill (${tenant})`}
        triggerLabel="ใช้ตำแหน่งปัจจุบัน (GPS)"
        tenantName={tenantName}
        onGranted={(_stream, coords) => {
          if (coords) void fillFromCoords(coords);
        }}
      >
        {() => (
          <button
            type="button"
            onClick={() => {
              const cached = lastCoords.current;
              if (cached) void fillFromCoords(cached);
            }}
            disabled={locating}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {locating ? 'กำลังค้นหาที่อยู่...' : 'ดึงที่อยู่จากพิกัดอีกครั้ง'}
          </button>
        )}
      </PermissionDialog>
      {geoError ? <p role="alert" className="text-xs text-red-600">{geoError}</p> : null}

      {input('ชื่อผู้รับ', 'name', 'ชื่อ-นามสกุล')}
      {input('เบอร์โทร', 'phone', '08xxxxxxxx')}
      {input('ที่อยู่', 'addressLine', 'บ้านเลขที่ ถนน ซอย')}
      <div className="grid grid-cols-2 gap-3">
        {input('ตำบล/แขวง', 'subdistrict', 'ตำบล')}
        {input('อำเภอ/เขต', 'district', 'อำเภอ')}
        {input('จังหวัด', 'province', 'จังหวัด')}
        {input('รหัสไปรษณีย์', 'postalCode', 'รหัสไปรษณีย์')}
      </div>

      <button type="button" onClick={save} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white">
        บันทึกที่อยู่
      </button>
      {saved ? <p role="status" className="text-xs text-emerald-700">บันทึกแบบร่างที่อยู่แล้ว (เฉพาะข้อความที่อยู่ ไม่เก็บพิกัด)</p> : null}
    </div>
  );
}

export default function LiffAddressPage() {
  return (
    <Suspense fallback={<div aria-busy>กำลังโหลดฟอร์มที่อยู่...</div>}>
      <AddressInner />
    </Suspense>
  );
}
