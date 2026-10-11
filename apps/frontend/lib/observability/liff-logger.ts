// SSOT Phase 121 Task 5 §2.1/§10 — LIFF lightweight logger (500KB ring)
// Canonical: apps/frontend/lib/observability/liff-logger.ts
// (legacy src/frontend/lib/observability/liff-logger.ts)
// - Ring buffer capped at 500KB total (Gate 5; drops oldest first),
//   PII-scrubbed pre-buffer, flushed via navigator.sendBeacon (no fetch
//   keepalive leaks on WebView close). W3C traceparent attached per line.
// - Browser + SSR-safe (no-ops without window/navigator). Zero new deps.
export type LiffLogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LiffLogLine {
  traceId: string;
  spanId: string;
  timestamp: string;
  level: LiffLogLevel;
  serviceName: string;
  tenantId?: string;
  action: string;
  message: string;
  context?: unknown;
}

/** LIFF ring cap: 500KB total buffered payload (spec §2.1). */
export const LIFF_BUFFER_CAP_BYTES = 500 * 1024;

const DENY = ['password', 'accesstoken', 'lineuserid', 'slipimageurl', 'bankaccountnumber', 'idcardnumber'];

/** Client-side PII scrub (mirrors the SSOT server scrubber). */
export function scrubLiffPayload<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v.replace(/\b\d{13}\b/g, '[REDACTED]');
      out = out.replace(/\b0\d(?:[-\s]?\d){8}\b/g, '[REDACTED]');
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        out[k] = DENY.includes(k.toLowerCase()) ? '[REDACTED]' : walk(child);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

function hex(nibbles: number): string {
  let out = '';
  for (let i = 0; i < nibbles; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

interface LoggerState {
  lines: LiffLogLine[];
  bytes: number;
  traceId: string;
  endpoint: string;
  tenantId: string;
}

const state: LoggerState = {
  lines: [],
  bytes: 0,
  traceId: hex(32),
  // No default endpoint: no ingest route ships in 121 scope (the buffer
  // still works offline-first; deploy wires `endpoint` explicitly).
  endpoint: '',
  tenantId: 'default',
};

/** Configure tenant + ingest endpoint (call once at LIFF_INIT). */
export function configureLiffLogger(args: { tenantId?: string; endpoint?: string; traceId?: string }): void {
  if (args.tenantId) state.tenantId = args.tenantId;
  if (args.endpoint) state.endpoint = args.endpoint;
  if (args.traceId) state.traceId = args.traceId;
}

/** Current buffered byte size (Gate 5 assertion lane). */
export function liffBufferBytes(): number {
  return state.bytes;
}

/** Test seam: reset the ring. */
export function resetLiffLoggerForTests(): void {
  state.lines = [];
  state.bytes = 0;
  state.traceId = hex(32);
}

function push(level: LiffLogLevel, action: string, message: string, context?: unknown): LiffLogLine {
  const line: LiffLogLine = {
    traceId: state.traceId,
    spanId: hex(16),
    timestamp: new Date().toISOString(),
    level,
    serviceName: 'liff-webview',
    tenantId: state.tenantId,
    action,
    message,
    context: context === undefined ? undefined : scrubLiffPayload(context),
  };
  const size = JSON.stringify(line).length;
  state.lines.push(line);
  state.bytes += size;
  while (state.bytes > LIFF_BUFFER_CAP_BYTES && state.lines.length > 0) {
    const dropped = state.lines.shift();
    state.bytes -= dropped ? JSON.stringify(dropped).length : 0;
  }
  return line;
}

/** Flush via sendBeacon (false when unavailable/empty/unconfigured). */
export function flushLiffLogs(): boolean {
  if (state.lines.length === 0 || !state.endpoint) return false;
  try {
    // DOM-lib-free lookup: this file compiles under backend tsconfigs too.
    const nav = (globalThis as Record<string, unknown>)['navigator'] as
      | { sendBeacon?: (url: string, data: string) => boolean }
      | undefined;
    if (typeof nav?.sendBeacon !== 'function') return false;
    const payload = JSON.stringify(state.lines);
    const ok = nav.sendBeacon(state.endpoint, payload);
    if (ok) {
      state.lines = [];
      state.bytes = 0;
    }
    return ok;
  } catch {
    return false;
  }
}

export const Logger = {
  trace: (action: string, message: string, context?: unknown): LiffLogLine => push('TRACE', action, message, context),
  debug: (action: string, message: string, context?: unknown): LiffLogLine => push('DEBUG', action, message, context),
  info: (action: string, message: string, context?: unknown): LiffLogLine => push('INFO', action, message, context),
  warn: (action: string, message: string, context?: unknown): LiffLogLine => push('WARN', action, message, context),
  error: (action: string, message: string, context?: unknown): LiffLogLine => push('ERROR', action, message, context),
  fatal: (action: string, message: string, context?: unknown): LiffLogLine => push('FATAL', action, message, context),
  flush: flushLiffLogs,
  bytes: liffBufferBytes,
};
