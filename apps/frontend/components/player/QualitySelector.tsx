// SSOT Phase 045 — QualitySelector (ABR + manual rendition switch)
// Canonical: apps/frontend/components/player/QualitySelector.tsx
// (legacy src/frontend/components/player/QualitySelector.tsx)
// - AUTO (native ABR) plus explicit rendition labels; switching swaps the
//   media source (native HLS) and resumes at the current timestamp.
// - Presentational; the player owns quality state. Zero new deps.
'use client';

import { useState } from 'react';

interface QualitySelectorProps {
  quality: string;
  qualities: string[];
  onChange: (quality: string) => void;
}

export function QualitySelector({ quality, qualities, onChange }: QualitySelectorProps) {
  const [open, setOpen] = useState(false);
  if (qualities.length === 0) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-white"
        aria-expanded={open}
        aria-label="Select video quality"
      >
        {quality}
      </button>
      {open && (
        <div className="absolute bottom-8 right-0 w-28 overflow-hidden rounded-lg bg-black/80 py-1">
          {['AUTO', ...qualities].map((label) => (
            <button
              key={label}
              onClick={() => {
                onChange(label);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left font-mono text-[11px] hover:bg-white/10 ${label === quality ? 'text-emerald-400' : 'text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default QualitySelector;
