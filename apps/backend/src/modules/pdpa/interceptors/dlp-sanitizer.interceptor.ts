// SSOT Phase 129 §7.1 — DLP sanitizer interceptor (AI-bound PII scrub)
// Canonical: apps/backend/src/modules/pdpa/interceptors/dlp-sanitizer.interceptor.ts
// (legacy src/backend/modules/pdpa/*; aliased under api/interceptors/)
// - sanitizeForAi() is pure: strips phone/email/national-ID/LINE-ID values
//   and pseudonymizes identifier keys to SHA-256 hashes before payloads
//   reach external AI engines or analytics pipes. Plain PII never leaves
//   the trust boundary; the hash is one-way (no re-identification without
//   the Finance/Auditor grant lane).
// - DlpSanitizerInterceptor applies it to handler responses (rxjs map,
//   rxjs rides Nest core). Zero new deps.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const PHONE_RE = /(^|[^0-9+])(?:\+66|0)(\d[\s-]?){8,9}(?![0-9])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const THAI_ID_RE = /(?<![0-9])[1-8]\d{12}(?![0-9])/g;
const LINE_UID_RE = /\bU[0-9a-f]{32}\b/g;

const IDENTIFIER_KEYS = new Set([
  'userId', 'user_id', 'lineUserId', 'line_user_id', 'customerId', 'memberId',
]);

/** One-way pseudonym (analytics-safe, §7.1 userIdHash lane). */
export function pseudonymize(value: string): string {
  return createHash('sha256').update(`pdpa-v1:${value}`, 'utf8').digest('hex');
}

function scrubString(value: string): string {
  // Global replace: a payload may carry many PII occurrences (e.g. a
  // stringified conversation). Only replacing the first would leak the rest.
  return value
    .replace(PHONE_RE, '$1[REDACTED_PHONE]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(THAI_ID_RE, '[REDACTED_ID]')
    .replace(LINE_UID_RE, '[REDACTED_LINE_UID]');
}

/** Deep-scrub any JSON-safe value for AI/analytics egress. */
export function sanitizeForAi(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof input === 'string') return scrubString(input);
  if (Array.isArray(input)) return input.map((v) => sanitizeForAi(v, depth + 1));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (IDENTIFIER_KEYS.has(k) && typeof v === 'string' && v.length > 0) {
        out[k] = pseudonymize(v);
        out[`${k}Hash`] = out[k];
      } else {
        out[k] = sanitizeForAi(v, depth + 1);
      }
    }
    return out;
  }
  return input;
}

@Injectable()
export class DlpSanitizerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => sanitizeForAi(data)));
  }
}
