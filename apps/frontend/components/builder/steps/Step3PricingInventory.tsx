'use client';

// SSOT Phase 074 §6.1 Step 3 — Pricing & inventory
// Canonical: apps/frontend/components/builder/steps/Step3PricingInventory.tsx
import React from 'react';
import { useFormContext } from 'react-hook-form';

export function Step3PricingInventory() {
  const { register, formState: { errors } } = useFormContext();
  return (
    <div className="merchant-form">
      <input placeholder="ราคา (บาท)" type="number" min={1} {...register('price', { valueAsNumber: true })} />
      {errors['price'] && <p role="alert">{String(errors['price']?.message)}</p>}
      <input placeholder="ราคาลด (ถ้ามี)" type="number" min={1} {...register('discountPrice', { valueAsNumber: true })} />
      <label>
        <input type="checkbox" {...register('isPublished')} /> เผยแพร่ทันที
      </label>
    </div>
  );
}
