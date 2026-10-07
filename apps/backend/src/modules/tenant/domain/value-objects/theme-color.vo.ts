// SSOT Phase 030 §3.1/§8 — ThemeColor value object (hex sanitization gate)
// Canonical: apps/backend/src/modules/tenant/domain/value-objects/theme-color.vo.ts
// (legacy src/backend/modules/tenant/domain/value-objects/theme-color.vo.ts)
// - Gate 4: strict hex validation at the domain boundary (CSS injection
//   prevention — arbitrary strings never reach CSS variables or the DB).
// - Normalizes 3-digit to 6-digit uppercase; exposes luminance + contrast.
// - Zero new deps.
import { contrastRatio, relativeLuminance } from '@repo/shared';

const HEX_RE = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export class ThemeColor {
  private constructor(readonly hex: string) {}

  static of(raw: string): ThemeColor {
    if (typeof raw !== 'string' || !HEX_RE.test(raw.trim())) throw new Error('Invalid Hex Color');
    const h = raw.trim();
    const full = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
    return new ThemeColor(full.toUpperCase());
  }

  luminance(): number {
    return relativeLuminance(this.hex);
  }

  contrastAgainst(other: ThemeColor): number {
    return contrastRatio(this.hex, other.hex);
  }
}
