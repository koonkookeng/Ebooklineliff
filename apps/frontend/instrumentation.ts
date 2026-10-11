// SSOT Phase 121 Task 5 §7.1 — Next.js instrumentation hook (server entry)
// Canonical: apps/frontend/instrumentation.ts
// (legacy src/frontend/instrumentation.ts)
// - Next.js calls register() once at server boot: marks the OTel lane
//   (backend-owned exporter) and records the boot timestamp for uptime
//   math. No SDK imports here (zero-dep; the hook must stay import-light).
// - Zero new deps.
export async function register(): Promise<void> {
  if (typeof process !== 'undefined' && process.env['NEXT_RUNTIME'] === 'nodejs') {
    const startedAt = Date.now();
    (globalThis as Record<string, unknown>)['__liff_boot_ms'] = startedAt;
    if (process.env['OTEL_SDK_DISABLED'] !== '1') {
      // Backend OTel exporter owns trace delivery; the edge only propagates
      // W3C headers (see lib/observability/liff-logger traceparent).
    }
  }
}
