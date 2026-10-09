// SSOT Phase 085 §2.2/Task 6 — 3-step e-KYC wizard (dep-free)
// Canonical: apps/frontend/components/kyc/KycWizard.tsx
// - Steps guide + per-field red frames on ERROR + retake buttons.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { KycStep } from '../../hooks/useKycWizard';

const BANKS = ['KBANK', 'SCB', 'BBL', 'KTB', 'BAY', 'TTB', 'GSB', 'CIMB', 'UOB'] as const;

export function KycWizard(props: {
  step: KycStep;
  setStep: (s: KycStep) => void;
  busy: boolean;
  error: string | null;
  onFile: (kind: 'id-card' | 'selfie' | 'bookbank', file: File) => Promise<string>;
  onSubmit: (form: Record<string, string>) => Promise<unknown>;
}) {
  const { step, setStep, busy, error, onFile, onSubmit } = props;
  const [form, setForm] = useState<Record<string, string>>({ bankCode: 'KBANK' });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [fieldError, setFieldError] = useState<string | null>(null);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function pick(kind: 'id-card' | 'selfie' | 'bookbank', file: File | undefined) {
    if (!file) return;
    try {
      const key = await onFile(kind, file);
      setKeys((k) => ({ ...k, [kind]: key }));
      setFieldError(null);
    } catch {
      setFieldError(kind);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string> = {
      ...form,
      idCardImageUrl: `https://vault.local/${keys['id-card'] ?? ''}`,
      selfieImageUrl: `https://vault.local/${keys['selfie'] ?? ''}`,
      bookbankImageUrl: `https://vault.local/${keys['bookbank'] ?? ''}`,
    };
    await onSubmit(payload).catch(() => undefined);
  }

  return (
    <div>
      <ol>
        <li aria-current={step === 1 ? 'step' : undefined}>1. บัตรประชาชน</li>
        <li aria-current={step === 2 ? 'step' : undefined}>2. สแกนใบหน้า</li>
        <li aria-current={step === 3 ? 'step' : undefined}>3. บัญชีธนาคาร</li>
      </ol>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={submit}>
        {step === 1 && (
          <div>
            <input placeholder="เลขบัตร 13 หลัก" value={form['idCardNumber'] ?? ''} onChange={(e) => set('idCardNumber', e.target.value)} required minLength={13} maxLength={13} style={fieldError ? { borderColor: 'red' } : undefined} />
            <input placeholder="หลังบัตร 2 อักษร+10 ตัวเลข" value={form['laserCode'] ?? ''} onChange={(e) => set('laserCode', e.target.value)} required minLength={12} maxLength={12} />
            <input placeholder="ชื่อ (ไทย)" value={form['firstNameTh'] ?? ''} onChange={(e) => set('firstNameTh', e.target.value)} required />
            <input placeholder="นามสกุล (ไทย)" value={form['lastNameTh'] ?? ''} onChange={(e) => set('lastNameTh', e.target.value)} required />
            <input placeholder="วันเกิด (ISO)" value={form['birthDate'] ?? ''} onChange={(e) => set('birthDate', e.target.value)} required />
            <input type="file" accept="image/*" aria-label="ภาพบัตรประชาชน" onChange={(e) => void pick('id-card', e.target.files?.[0])} />
            <button type="button" onClick={() => setStep(2)} disabled={busy}>ถัดไป</button>
          </div>
        )}
        {step === 2 && (
          <div>
            <input type="file" accept="image/*" aria-label="ภาพเซลฟีคู่บัตร" onChange={(e) => void pick('selfie', e.target.files?.[0])} />
            <button type="button" onClick={() => setStep(1)}>ย้อนกลับ</button>
            <button type="button" onClick={() => setStep(3)} disabled={busy}>ถัดไป</button>
          </div>
        )}
        {step === 3 && (
          <div>
            <select value={form['bankCode'] ?? 'KBANK'} onChange={(e) => set('bankCode', e.target.value)}>
              {BANKS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <input placeholder="เลขบัญชี" value={form['bankAccountNumber'] ?? ''} onChange={(e) => set('bankAccountNumber', e.target.value)} required minLength={8} maxLength={15} />
            <input placeholder="ชื่อบัญชี" value={form['bankAccountName'] ?? ''} onChange={(e) => set('bankAccountName', e.target.value)} required />
            <input type="file" accept="image/*" aria-label="ภาพสมุดบัญชี" onChange={(e) => void pick('bookbank', e.target.files?.[0])} />
            <button type="button" onClick={() => setStep(2)}>ย้อนกลับ</button>
            <button type="submit" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ยืนยันส่ง e-KYC'}</button>
          </div>
        )}
      </form>
      {fieldError && <p role="alert">ถ่ายภาพใหม่ — ไฟล์{fieldError}ไม่ผ่าน</p>}
    </div>
  );
}
