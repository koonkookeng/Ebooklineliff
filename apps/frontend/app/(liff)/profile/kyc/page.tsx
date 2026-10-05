// SSOT Phase 003 §6.1 — e-KYC submission form (5-state: INIT/IDLE/LOADING/SUCCESS/ERROR, RAM-guarded)
'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreatorKYCSchema, type CreatorKYCInput } from '@repo/shared';

type KYCFormData = CreatorKYCInput;
type UIState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export default function CreatorKYCPage() {
  const [uiState, setUiState] = useState<UIState>('IDLE');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<KYCFormData>({
    resolver: zodResolver(CreatorKYCSchema),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Upload to Cloudflare R2 vault via backend API
      const res = await fetch('/api/vault/kyc-upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.fileUrl) {
        setValue('idCardImageUrl', data.fileUrl);
      } else {
        setError('อัปโหลดรูปภาพล้มเหลว กรุณาลองใหม่อีกครั้ง');
      }
    } catch {
      setError('อัปโหลดรูปภาพล้มเหลว กรุณาลองใหม่อีกครั้ง');
    } finally {
      setUploadingImage(false);
    }
  };

  const onSubmit = async (data: KYCFormData) => {
    setUiState('LOADING');
    setError(null);
    try {
      const res = await fetch('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            mutation SubmitKYC($input: CreatorKYCInput!) {
              submitCreatorKYC(input: $input) { id }
            }
          `,
          variables: { input: data },
        }),
      });

      const result = await res.json();
      if (result.data?.submitCreatorKYC) {
        setUiState('SUCCESS');
      } else {
        setUiState('ERROR');
        setError('เกิดข้อผิดพลาดในการส่งข้อมูล');
      }
    } catch {
      setUiState('ERROR');
      setError('เกิดข้อผิดพลาดในการส่งข้อมูล');
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 bg-white rounded-lg shadow-md">
      <h1 className="text-xl font-bold mb-4 text-emerald-800">ยืนยันตัวตนผู้ขาย/ผู้สอน (e-KYC)</h1>
      {uiState === 'SUCCESS' ? (
        <p className="text-emerald-700">ยื่นเอกสารยืนยันตัวตนสำเร็จ ระบบกำลังดำเนินการตรวจสอบ</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">เลขประจำตัวประชาชน 13 หลัก</label>
            <input
              {...register('idCardNumber')}
              className="w-full border p-2 rounded mt-1"
              placeholder="x-xxxx-xxxxx-xx-x"
            />
            {errors.idCardNumber && (
              <p className="text-red-500 text-xs mt-1">{errors.idCardNumber.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">รูปถ่ายบัตรประชาชน</label>
            <input type="file" accept="image/*" onChange={handleFileUpload} className="w-full mt-1" />
            {uploadingImage && <p className="text-xs text-amber-600">กำลังอัปโหลดรูปภาพ...</p>}
            {errors.idCardImageUrl && (
              <p className="text-red-500 text-xs mt-1">{errors.idCardImageUrl.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">ธนาคารรับเงิน</label>
            <input
              {...register('bankName')}
              className="w-full border p-2 rounded mt-1"
              placeholder="กสิกรไทย / ไทยพาณิชย์"
            />
            {errors.bankName && (
              <p className="text-red-500 text-xs mt-1">{errors.bankName.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">เลขที่บัญชีธนาคาร</label>
            <input
              {...register('bankAccountNumber')}
              className="w-full border p-2 rounded mt-1"
              placeholder="xxx-x-xxxxx-x"
            />
            {errors.bankAccountNumber && (
              <p className="text-red-500 text-xs mt-1">{errors.bankAccountNumber.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">ชื่อบัญชีธนาคาร</label>
            <input {...register('bankAccountName')} className="w-full border p-2 rounded mt-1" />
            {errors.bankAccountName && (
              <p className="text-red-500 text-xs mt-1">{errors.bankAccountName.message}</p>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={uiState === 'LOADING' || uploadingImage}
            className="w-full bg-emerald-600 text-white p-3 rounded font-bold hover:bg-emerald-700 disabled:opacity-50"
          >
            {uiState === 'LOADING' ? 'กำลังส่งข้อมูล...' : 'ยื่นข้อมูลยืนยันตัวตน'}
          </button>
        </form>
      )}
    </div>
  );
}
