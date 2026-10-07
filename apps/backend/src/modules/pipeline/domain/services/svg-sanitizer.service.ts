// SSOT Phase 038 Task 4 — SVG sanitizer (XSS/XXE gate for reader-bound SVG)
// Canonical: apps/backend/src/modules/pipeline/domain/services/svg-sanitizer.service.ts
// (legacy src/backend/modules/pipeline/domain/services/svg-sanitizer.service.ts)
// - Strips: script/style elements, event-handler attributes, javascript:/data:
//   text URIs in href/xlink:href, DOCTYPE/ENTITY declarations (XXE), and
//   foreignObject (HTML injection into the reader DOM, Gate 4).
// - Pure string transforms (no DOMParser — worker-safe, zero new deps).
import { Injectable } from '@nestjs/common';

/** Sanitize reader-bound SVG (pure, unit-tested). Returns clean SVG or throws. */
export function sanitizeSvg(raw: string): string {
  if (typeof raw !== 'string' || !raw) throw new Error('Empty SVG content');
  let out = raw;
  out = out.replace(/<!DOCTYPE[^>]*>/gi, '');
  out = out.replace(/<!ENTITY[^>]*>/gi, '');
  out = out.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  // Event-handler attributes (onload, onclick, ...), quoted or not.
  out = out.replace(/\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, '');
  // Dangerous URI schemes in href/xlink:href.
  out = out.replace(/\s+(xlink:)?href\s*=\s*("|\')\s*javascript:[^"']*("|\')/gi, ' href="#blocked"');
  out = out.replace(/\s+(xlink:)?href\s*=\s*("|\')\s*data:text\/html[^"']*("|\')/gi, ' href="#blocked"');
  if (!/<svg[\s>]/i.test(out)) throw new Error('Not an SVG document');
  return out;
}

@Injectable()
export class SvgSanitizerService {
  sanitize(raw: string): string {
    return sanitizeSvg(raw);
  }
}
