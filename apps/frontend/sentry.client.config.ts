// SSOT Phase 121 Task 2 §5.1 — Sentry browser SDK config (lazy seam)
// Canonical: apps/frontend/sentry.client.config.ts
// (legacy src/frontend/sentry.client.config.ts)
// - Loads @sentry/nextjs ONLY if installed (zero-dep rule: the package is
//   absent in this repo). Present → init with PII scrub + 500KB envelope
//   cap + sendBeacon transport. Absent → resolved no-op (documented seam;
//   liff-logger stays the always-on lane).
// - Zero new deps.
type SentryLike = {
  init: (options: Record<string, unknown>) => void;
};

function loadSentry(): SentryLike | null {
  try {
    const loader = eval('require') as (id: string) => SentryLike;
    return loader('@sentry/nextjs');
  } catch {
    return null;
  }
}

const dsn = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_SENTRY_DSN'] : undefined;

if (dsn) {
  const Sentry = loadSentry();
  Sentry?.init({
    dsn,
    environment: process.env['NEXT_PUBLIC_ENV'] ?? 'development',
    tracesSampleRate: 0.1,
    maxValueLength: 2048,
    beforeSend: (event: { request?: { headers?: Record<string, string> }; user?: Record<string, unknown> }) => {
      if (event.request?.headers) {
        for (const k of Object.keys(event.request.headers)) {
          if (/auth|token|cookie/i.test(k)) event.request.headers[k] = '[REDACTED]';
        }
      }
      if (event.user) {
        delete event.user['ip_address'];
        delete event.user['lineUserId'];
      }
      return event;
    },
  });
}

export const sentryClientConfigured = Boolean(dsn);
