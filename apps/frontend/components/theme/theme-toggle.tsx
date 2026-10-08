// SSOT Phase 066 Task 6 — ThemeToggle (5-mode switcher + reader prefs)
// Canonical: apps/frontend/components/theme/theme-toggle.tsx
// (legacy src/frontend/components/theme/theme-toggle.tsx)
// - 5 modes (LIGHT/DARK/SEPIA/OLED_BLACK/SYSTEM) + font-size stepper;
//   writes ride persistThemeChange (debounced PATCH + rollback).
// - Zero new deps.
'use client';

import { useThemeStore } from '../../stores/use-theme-store';
import { persistThemeChange } from '../../providers/theme-provider';
import type { ReadingThemeMode } from '@repo/shared';

const MODES: Array<{ value: ReadingThemeMode; label: string; icon: string }> = [
  { value: 'LIGHT', label: 'สว่าง', icon: '☀️' },
  { value: 'DARK', label: 'มืด', icon: '🌙' },
  { value: 'SEPIA', label: 'ซีเปีย', icon: '📜' },
  { value: 'OLED_BLACK', label: 'ดำสนิท', icon: '⬛' },
  { value: 'SYSTEM', label: 'ตามระบบ', icon: '⚙️' },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const themeMode = useThemeStore((s) => s.themeMode);
  const fontSizePx = useThemeStore((s) => s.fontSizePx);
  const uiState = useThemeStore((s) => s.uiState);

  return (
    <div className="flex items-center gap-1" role="group" aria-label="โหมดการอ่าน">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.label}
          aria-pressed={themeMode === m.value}
          onClick={() => persistThemeChange({ themeMode: m.value }, 'READER_TOOLBAR')}
          className={`min-h-[44px] min-w-[44px] rounded-md px-2 text-sm transition ${
            themeMode === m.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          <span aria-hidden>{m.icon}</span>
          {!compact && <span className="ml-1 text-xs">{m.label}</span>}
        </button>
      ))}
      {!compact && (
        <span className="ml-2 flex items-center gap-1 text-xs">
          <button
            type="button"
            aria-label="ลดขนาดตัวอักษร"
            onClick={() => persistThemeChange({ fontSizePx: Math.max(12, fontSizePx - 1) }, 'READER_TOOLBAR')}
            className="min-h-[44px] min-w-[44px] rounded-md border border-border"
          >
            A-
          </button>
          <span className="w-8 text-center">{fontSizePx}</span>
          <button
            type="button"
            aria-label="เพิ่มขนาดตัวอักษร"
            onClick={() => persistThemeChange({ fontSizePx: Math.min(36, fontSizePx + 1) }, 'READER_TOOLBAR')}
            className="min-h-[44px] min-w-[44px] rounded-md border border-border"
          >
            A+
          </button>
          {uiState === 'LOADING' && <span className="animate-pulse">•</span>}
        </span>
      )}
    </div>
  );
}

export default ThemeToggle;
