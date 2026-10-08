'use client';

// SSOT Phase 074 §6.1 Step 1 — Type selector + basics
// Canonical: apps/frontend/components/builder/steps/Step1TypeSelector.tsx
import React from 'react';
import { useFormContext } from 'react-hook-form';

const TYPES = ['PHYSICAL_BOOK', 'EBOOK', 'ELEARNING_COURSE', 'HYBRID_BUNDLE'] as const;

export function Step1TypeSelector() {
  const { register, formState: { errors } } = useFormContext();
  return (
    <div className="merchant-form">
      <label>
        ประเภทสินค้า
        <select {...register('productType')}>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <input placeholder="ชื่อสินค้า (≥3 ตัวอักษร)" {...register('title')} />
      {errors['title'] && <p role="alert">{String(errors['title']?.message)}</p>}
      <input placeholder="slug (a-z 0-9 -)" {...register('slug')} />
      {errors['slug'] && <p role="alert">{String(errors['slug']?.message)}</p>}
      <input placeholder="คำอธิบาย (≥10 ตัวอักษร)" {...register('description')} />
      {errors['description'] && <p role="alert">{String(errors['description']?.message)}</p>}
      <input placeholder="URL รูปปก" {...register('coverImageUrl')} />
      {errors['coverImageUrl'] && <p role="alert">{String(errors['coverImageUrl']?.message)}</p>}
    </div>
  );
}
