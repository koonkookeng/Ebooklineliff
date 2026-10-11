// SSOT Phase 121 Task 3 §8.1 — PII redaction utility (shared scrub facade)
// Canonical: apps/backend/src/infra/logger/redact-pii.utility.ts
// (legacy src/backend/infra/logger/redact-pii.utility.ts)
// - Thin facade over the SSOT scrubPii primitive (single implementation).
//   Extra per-call keys supported. Pure. Zero new deps.
import { REDACTED, scrubPii } from '@repo/shared';

export { REDACTED };

/** Scrub any JSON-able value (objects/arrays/strings). */
export function redactPii<T>(value: T, extraKeys: string[] = []): T {
  return scrubPii(value, extraKeys);
}

/** True when a value still carries a denylisted key (audit helper). */
export function containsPiiKeys(value: unknown, extraKeys: string[] = []): boolean {
  const denied = new Set(['password', 'accesstoken', 'lineuserid', 'slipimageurl', 'bankaccountnumber', 'idcardnumber', ...extraKeys.map((k) => k.toLowerCase())]);
  let found = false;
  const walk = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (denied.has(k.toLowerCase())) {
          found = true;
          return;
        }
        walk(child);
      }
    }
  };
  walk(value);
  return found;
}
