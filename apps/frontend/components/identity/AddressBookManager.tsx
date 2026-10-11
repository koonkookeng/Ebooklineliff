// SSOT Phase 003 §2.2/BUSINESS_GOAL — address book manager (5-state CRUD)
// Canonical: apps/frontend/components/identity/AddressBookManager.tsx
// (legacy src/frontend/components/identity/*)
// - LIFF_INIT (splash) -> IDLE (list) -> LOADING (save/delete) -> SUCCESS
//   (toast + refetch) / ERROR (inline + retry). RHF + Zod per the 003 spec
//   pattern (deps installed). Zero new deps.
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserAddressSchema, type UserAddressInput } from '@repo/shared';

// RHF works on the schema INPUT (isDefault optional pre-default); the GQL
// lane takes the OUTPUT (defaults applied) — onSubmit normalizes explicitly.
type AddressFormData = z.input<typeof UserAddressSchema>;

export type AddressUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface AddressView extends UserAddressInput {
  id: string;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`address ${res.status}`);
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
  if (!body?.data) throw new Error('address failed');
  return body.data;
}

const EMPTY_FORM: UserAddressInput = {
  recipient: '',
  phoneNumber: '',
  addressLine1: '',
  addressLine2: '',
  subdistrict: '',
  district: '',
  province: '',
  postalCode: '',
  isDefault: false,
};

export function AddressBookManager() {
  const [uiState, setUiState] = useState<AddressUiState>('LIFF_INIT');
  const [addresses, setAddresses] = useState<AddressView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<AddressFormData>({ resolver: zodResolver(UserAddressSchema), defaultValues: EMPTY_FORM });

  const load = useCallback(async () => {
    try {
      const data = await gql<{ me: { addresses: AddressView[] } }>(
        'query { me { addresses { id recipient phoneNumber addressLine1 addressLine2 subdistrict district province postalCode isDefault } } }',
        {},
      );
      setAddresses(data.me.addresses);
      setUiState('IDLE');
    } catch {
      setNotice('โหลดที่อยู่ไม่สำเร็จ');
      setUiState('ERROR');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const onSubmit = async (form: AddressFormData) => {
    setUiState('LOADING');
    setNotice(null);
    const input: UserAddressInput = { ...form, isDefault: form.isDefault ?? false };
    try {
      await gql('mutation ($input: UserAddressInput!) { upsertUserAddress(input: $input) { id } }', {
        input: editingId ? { ...input, id: editingId } : input,
      });
      reset(EMPTY_FORM);
      setEditingId(null);
      setNotice('บันทึกที่อยู่สำเร็จ');
      setUiState('SUCCESS');
      await load();
    } catch {
      setNotice('บันทึกที่อยู่ไม่สำเร็จ กรุณาลองอีกครั้ง');
      setUiState('ERROR');
    }
  };

  const onDelete = async (id: string) => {
    setUiState('LOADING');
    try {
      await gql('mutation ($addressId: ID!) { deleteUserAddress(addressId: $addressId) }', { addressId: id });
      setNotice('ลบที่อยู่สำเร็จ');
      setUiState('SUCCESS');
      await load();
    } catch {
      setNotice('ลบที่อยู่ไม่สำเร็จ');
      setUiState('ERROR');
    }
  };

  const onEdit = (row: AddressView) => {
    setEditingId(row.id);
    for (const key of ['recipient', 'phoneNumber', 'addressLine1', 'addressLine2', 'subdistrict', 'district', 'province', 'postalCode'] as const) {
      setValue(key, row[key] ?? '');
    }
    setValue('isDefault', row.isDefault ?? false);
    setUiState('IDLE');
  };

  if (uiState === 'LIFF_INIT') {
    return (
      <main aria-busy="true" style={{ padding: 24 }}>
        <p>กำลังโหลดสมุดที่อยู่…</p>
      </main>
    );
  }

  return (
    <section aria-label="address-book">
      {notice ? <p role={uiState === 'ERROR' ? 'alert' : 'status'}>{notice}</p> : null}
      <ul>
        {addresses.map((a) => (
          <li key={a.id}>
            <strong>{a.recipient}</strong> {a.addressLine1} {a.district} {a.province} {a.postalCode}
            {a.isDefault ? ' (ค่าเริ่มต้น)' : null}{' '}
            <button type="button" onClick={() => onEdit(a)}>แก้ไข</button>{' '}
            <button type="button" onClick={() => void onDelete(a.id)}>ลบ</button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
        <div>
          <label>ชื่อผู้รับ</label>
          <input {...register('recipient')} />
          {errors.recipient ? <p role="alert">{errors.recipient.message}</p> : null}
        </div>
        <div>
          <label>โทรศัพท์ (0xxxxxxxxx)</label>
          <input {...register('phoneNumber')} inputMode="tel" />
          {errors.phoneNumber ? <p role="alert">{errors.phoneNumber.message}</p> : null}
        </div>
        <div>
          <label>ที่อยู่บรรทัดที่ 1</label>
          <input {...register('addressLine1')} />
          {errors.addressLine1 ? <p role="alert">{errors.addressLine1.message}</p> : null}
        </div>
        <div>
          <label>ตำบล/แขวง</label>
          <input {...register('subdistrict')} />
          {errors.subdistrict ? <p role="alert">{errors.subdistrict.message}</p> : null}
        </div>
        <div>
          <label>อำเภอ/เขต</label>
          <input {...register('district')} />
          {errors.district ? <p role="alert">{errors.district.message}</p> : null}
        </div>
        <div>
          <label>จังหวัด</label>
          <input {...register('province')} />
          {errors.province ? <p role="alert">{errors.province.message}</p> : null}
        </div>
        <div>
          <label>รหัสไปรษณีย์ (5 หลัก)</label>
          <input {...register('postalCode')} inputMode="numeric" />
          {errors.postalCode ? <p role="alert">{errors.postalCode.message}</p> : null}
        </div>
        <label>
          <input type="checkbox" {...register('isDefault')} /> ตั้งเป็นค่าเริ่มต้น
        </label>
        <button type="submit" disabled={uiState === 'LOADING'} style={{ minHeight: 44 }}>
          {uiState === 'LOADING' ? 'กำลังบันทึก…' : editingId ? 'อัปเดตที่อยู่' : 'เพิ่มที่อยู่'}
        </button>
      </form>
    </section>
  );
}

export default AddressBookManager;
