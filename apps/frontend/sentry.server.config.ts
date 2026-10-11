// SSOT Phase 121 Task 2 §5.1 — Sentry server SDK config (lazy seam)
// Canonical: apps/frontend/sentry.server.config.ts
// (legacy src/frontend/sentry.server.config.ts)
// - Same lazy seam as the client config: real @sentry/nextjs only when
//   installed, with server-side PII scrub. Absent → no-op.
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

const dsn = typeof process !== 'undefined' ? process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'] : undefined;

if (dsn) {
  const Sentry = loadSentry();
  Sentry?.init({
    dsn,
    environment: process.env['NEXT_PUBLIC_ENV'] ?? 'development',
    tracesSampleRate: 0.1,
    beforeSend: (event: { user?: Record<string, unknown>; contexts?: Record<string, unknown> }) => {
      if (event.user) {
        delete event.user['ip_address'];
        delete event.user['lineUserId'];
      }
      return event;
    },
  });
}

export const sentryServerConfigured = Boolean(dsn);
