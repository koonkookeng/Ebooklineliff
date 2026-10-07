// SSOT Phase 041 Task 5 — ThemeSettingsPopover (eye-care themes, §6.4)
// Canonical: apps/frontend/components/reader/ThemeSettingsPopover.tsx
// (legacy src/frontend/components/reader/ThemeSettingsPopover.tsx)
// - Hosts §8.1 getWatermarkStyleForTheme (forensic overlay auto-contrast per
//   theme — Gate 4) next to the reader surface that consumes it.
// - Persists via the store (localStorage) and syncs server-side through the
//   preferences proxy ( caller-owned; this popover stays presentational).
// - Zero new deps (inline SVG glyphs).
'use client';

import type { ThemeMode } from '@repo/shared';
import { useReaderStore } from '../../stores/useReaderStore';

interface ThemeSettingsPopoverProps {
  onClose: () => void;
}

export interface WatermarkThemeStyle {
  color: string;
  mixBlendMode: 'multiply' | 'screen';
}

/** §8.1 — forensic watermark auto-contrast per theme (tamper-proof). */
export function getWatermarkStyleForTheme(theme: ThemeMode): WatermarkThemeStyle {
  switch (theme) {
    case 'DARK':
    case 'OLED_BLACK':
      return { color: 'rgba(255, 255, 255, 0.18)', mixBlendMode: 'screen' };
    case 'SEPIA':
      return { color: 'rgba(95, 75, 50, 0.22)', mixBlendMode: 'multiply' };
    case 'LIGHT':
    default:
      return { color: 'rgba(0, 0, 0, 0.15)', mixBlendMode: 'multiply' };
  }
}

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0" aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; bg: string; text: string; glyph: string }> = [
  { mode: 'LIGHT', label: 'สว่าง', bg: 'bg-white', text: 'text-slate-900', glyph: 'M12 3v1m0 16v1M5.6 5.6l.7.7m11.4 11.4l.7.7M3 12h1m16 0h1M5.6 18.4l.7-.7m11.4-11.4l.7-.7M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { mode: 'SEPIA', label: 'ถนอมสายตา', bg: 'bg-[#FBF0D9]', text: 'text-[#5F4B32]', glyph: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zm10 3a3 3 0 100-6 3 3 0 000 6z' },
  { mode: 'DARK', label: 'มืด', bg: 'bg-slate-900', text: 'text-slate-100', glyph: 'M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z' },
  { mode: 'OLED_BLACK', label: 'ดำสนิท', bg: 'bg-black', text: 'text-gray-200', glyph: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm5 16h4' },
];

export function ThemeSettingsPopover({ onClose }: ThemeSettingsPopoverProps) {
  const theme = useReaderStore((s) => s.theme);
  const fontSizePx = useReaderStore((s) => s.fontSizePx);

  return (
    <div className="w-72 space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ธีมการแสดงผล</h3>
        <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-accent" aria-label="Close theme settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {THEME_OPTIONS.map((opt) => {
          const isSelected = theme === opt.mode;
          return (
            <button
              key={opt.mode}
              onClick={() => useReaderStore.setTheme(opt.mode)}
              aria-pressed={isSelected}
              className={`flex items-center space-x-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${opt.bg} ${opt.text} ${
                isSelected ? 'border-transparent ring-2 ring-primary' : 'border-border'
              }`}
            >
              <Glyph d={opt.glyph} />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      <hr className="border-border" />
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">ขนาดตัวอักษร</span>
          <span className="font-bold">{fontSizePx}px</span>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => useReaderStore.setFontSizePx(Math.max(12, fontSizePx - 2))}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-sm font-bold hover:bg-accent"
            aria-label="Decrease font size"
          >
            ก-
          </button>
          <div className="flex-1 text-center text-xs text-muted-foreground">ปรับขนาด</div>
          <button
            onClick={() => useReaderStore.setFontSizePx(Math.min(36, fontSizePx + 2))}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-lg font-bold hover:bg-accent"
            aria-label="Increase font size"
          >
            ก+
          </button>
        </div>
      </div>
    </div>
  );
}

export default ThemeSettingsPopover;
