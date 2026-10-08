// SSOT Phase 077 §2.1 — Buyer tracking stepper (dep-free, <25MB)
// Canonical: apps/frontend/components/fulfillment/TrackingStepper.tsx
// - Native progress stepper driven by trackingStages(); carrier brand bar.
// - Zero-dep (React only).
'use client';

import React from 'react';
import { carrierBrand, trackingStages } from '@repo/shared';

export function TrackingStepper({ carrier, status }: { carrier: string; status: string }) {
  const brand = carrierBrand(carrier);
  const stages = trackingStages(status);
  return (
    <div>
      <div style={{ background: brand.bg, color: brand.fg, padding: '8px 12px', borderRadius: 8 }}>
        <strong>{carrier}</strong>
      </div>
      <ol style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
        {stages.map((s) => (
          <li key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: s.done ? 1 : 0.45 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: s.done ? '#1DB446' : '#e2e8f0',
                color: '#fff',
                fontSize: 12,
                textAlign: 'center',
                lineHeight: '18px',
              }}
            >
              {s.done ? '✓' : '·'}
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
