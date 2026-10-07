// SSOT Phase 030 §7 — Contrast calculator (WCAG 2.1 AA auto-text engine)
// Canonical: apps/backend/src/modules/tenant/domain/services/contrast-calculator.service.ts
// (legacy src/backend/modules/tenant/domain/services/contrast-calculator.service.ts)
// - BDD Scenario 2: verifies contrast ≥ 4.5:1, auto-adjusts text/icon color to
//   the readable extreme otherwise (readability 100%).
// - Thin injectable over the shared pure engine (tested without Nest).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  WCAG_AA_MIN_RATIO,
  contrastRatio,
  ensureReadableText,
  resolveIconTheme,
  type NavigationBarIconTheme,
} from '@repo/shared';
import { ThemeColor } from '../value-objects/theme-color.vo';

export interface ContrastVerdict {
  ratio: number;
  passesAA: boolean;
  textColor: string;
  iconTheme: 'LIGHT' | 'DARK';
}

@Injectable()
export class ContrastCalculatorService {
  check(navBarBgColor: string, preferredTextColor: string, iconTheme: NavigationBarIconTheme): ContrastVerdict {
    const bg = ThemeColor.of(navBarBgColor);
    const preferred = ThemeColor.of(preferredTextColor);
    const ratio = bg.contrastAgainst(preferred);
    return {
      ratio: Math.round(ratio * 100) / 100,
      passesAA: ratio >= WCAG_AA_MIN_RATIO,
      textColor: ensureReadableText(bg.hex, preferred.hex),
      iconTheme: resolveIconTheme(iconTheme, bg.hex),
    };
  }

  ratioOf(bgHex: string, fgHex: string): number {
    return contrastRatio(bgHex, fgHex);
  }
}
