'use client';

// SSOT Phase 074 §6.1 Step 4 — Preview & publish confirm
// Canonical: apps/frontend/components/builder/steps/Step4PreviewPublish.tsx
import React from 'react';
import { useFormContext } from 'react-hook-form';

export function Step4PreviewPublish() {
  const { watch } = useFormContext();
  const v = watch();
  return (
    <div className="merchant-card">
      <h3>{String(v['title'] || 'Untitled')}</h3>
      <p>{String(v['description'] || '')}</p>
      <p>ประเภท: {String(v['productType'])} · ราคา ฿{String(v['price'])}</p>
      {v['coverImageUrl'] ? <img src={String(v['coverImageUrl'])} alt="cover" width={160} /> : null}
    </div>
  );
}
