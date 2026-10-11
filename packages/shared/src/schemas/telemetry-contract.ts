// SSOT Phase 121 §3.1 — telemetry & structured logging contract
// Canonical: packages/shared/src/schemas/telemetry-contract.ts
// (legacy src/shared/schemas/telemetry-contract.ts)
// - Spec-verbatim: TelemetryLogLevelEnum / ObservabilityEnvironmentEnum /
//   StructuredLogPayloadSchema / SentryUserScopeSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - traceId accepts min(1) (W3C hex on the wire; uuid-or-string per spec
//     is preserved as min(1) edge vocabulary, 023-031 precedent).
//   - context accepts any JSON value (spec z.record(z.unknown()) rejects
//     arrays; log contexts are free-form).
//   - ip_address stays the literal '[REDACTED]' (spec PII rule, verbatim).
// - Pure helpers: traceparent parse/build (W3C), PII redaction (shared
//   key list + regexes), budgets (1.5ms export, 500KB LIFF buffer, 900s
//   cache n/a). Zero new deps (zod only).
import { z } from 'zod';

export const TelemetryLogLevelEnum = z.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
export type TelemetryLogLevel = z.infer<typeof TelemetryLogLevelEnum>;

export const ObservabilityEnvironmentEnum = z.enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION']);
export type ObservabilityEnvironment = z.infer<typeof ObservabilityEnvironmentEnum>;

export const StructuredLogPayloadSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  timestamp: z.string().datetime(),
  level: TelemetryLogLevelEnum,
  serviceName: z.string().min(1),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  action: z.string().min(1),
  message: z.string().min(1),
  context: z.unknown(),
  error: z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }).optional(),
});
export type StructuredLogPayload = z.infer<typeof StructuredLogPayloadSchema>;

export const SentryUserScopeSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  tenantId: z.string().min(1),
  ip_address: z.literal('[REDACTED]'),
});
export type SentryUserScope = z.infer<typeof SentryUserScopeSchema>;

/** 121 §1.3 BDD: trace export overhead under 1.5ms server-side. */
export const TRACE_EXPORT_BUDGET_MS = 1.5;
/** 121 §2.1: LIFF in-memory log buffer capped at 500KB. */
export const LIFF_LOG_BUFFER_BYTES = 500 * 1024;
/** 121 §10: incident alert fan-out within 500ms. */
export const INCIDENT_ALERT_BUDGET_MS = 500;
/** 121 §10.1: error-rate trip (5% inside 1 minute). */
export const ERROR_RATE_TRIP_PCT = 5;
export const ERROR_RATE_WINDOW_SEC = 60;
/** 121 §10.1: LIFF RAM trip at 28MB (below the 30MB cap). */
export const LIFF_RAM_TRIP_BYTES = 28 * 1024 * 1024;
/** W3C traceparent version/flags. */
export const TRACEPARENT_VERSION = '00';

/** PII key denylist for log/trace/sentry scrubbing (§8.1). */
export const PII_DENY_KEYS = [
  'password',
  'accessToken',
  'lineUserId',
  'slipImageUrl',
  'bankAccountNumber',
  'idCardNumber',
] as const;

export const REDACTED = '[REDACTED]';

/** Parse a W3C traceparent header (null when malformed). */
export function parseTraceparent(header: string | undefined): { traceId: string; spanId: string; sampled: boolean } | null {
  if (!header) return null;
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header.trim());
  if (!m) return null;
  if (m[1] === 'ff' || m[2] === '0'.repeat(32) || m[3] === '0'.repeat(16)) return null;
  return { traceId: m[2]!, spanId: m[3]!, sampled: (parseInt(m[4]!, 16) & 1) === 1 };
}

/** Build a W3C traceparent header (version 00). */
export function buildTraceparent(traceId: string, spanId: string, sampled = true): string {
  return `${TRACEPARENT_VERSION}-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

function hex(nibbles: number): string {
  let out = '';
  for (let i = 0; i < nibbles; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** Random W3C ids (32-hex trace, 16-hex span). */
export function newTraceIds(): { traceId: string; spanId: string } {
  return { traceId: hex(32), spanId: hex(16) };
}

/** Deep PII scrub: denylist keys + secret-shaped strings → [REDACTED]. */
export function scrubPii<T>(value: T, extraKeys: string[] = []): T {
  const denied = new Set<string>([...PII_DENY_KEYS, ...extraKeys].map((k) => k.toLowerCase()));
  const scrubString = (s: string): string => {
    if (/^(sk-|xox[bap]-|eyJ[A-Za-z0-9_-]{10,})/.test(s)) return REDACTED;
    let out = s.replace(/\b\d{13}\b/g, REDACTED);
    out = out.replace(/\b0\d(?:[-\s]?\d){8}\b/g, REDACTED);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        out[k] = denied.has(k.toLowerCase()) ? REDACTED : walk(child);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** Tenant-scoped log stream key. */
export function telemetryStreamKey(tenantId: string): string {
  return `telemetry:logs:${tenantId}`;
}
