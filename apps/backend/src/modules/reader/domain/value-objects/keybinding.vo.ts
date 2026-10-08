// SSOT Phase 059 §5.1 — Keybinding VO (custom keymap sanitize)
// Canonical: apps/backend/src/modules/reader/domain/value-objects/keybinding.vo.ts
// - Pure, tsx-safe. Accepts a JSON keymap like { NEXT: "Space" } and keeps
//   only known KeyboardEvent.code strings (≤20 entries, ≤24 chars each).
// - Invalid maps fall back to {} (defaults in keyIntentFor) — never throws
//   on user input. Zero new deps.
const KNOWN_CODES = new Set([
  'Space',
  'ArrowRight',
  'ArrowDown',
  'PageDown',
  'ArrowLeft',
  'ArrowUp',
  'PageUp',
  'Home',
  'End',
  'KeyM',
  'KeyF',
  'KeyN',
  'KeyP',
  'KeyB',
  'Backspace',
  'Enter',
]);

export type KeybindingMap = Record<string, string>;

export function sanitizeKeybindings(input: unknown): KeybindingMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: KeybindingMap = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= 20) break;
    if (typeof k !== 'string' || k.length === 0 || k.length > 12) continue;
    if (typeof v !== 'string' || !KNOWN_CODES.has(v)) continue;
    out[k.toUpperCase()] = v;
  }
  return out;
}
