// SSOT Phase 121 Task 2 §5.1 — Sentry client wrapper (lazy zero-dep seam)
// Canonical: apps/backend/src/infra/sentry/sentry.service.ts
// (legacy src/backend/infra/sentry/sentry.service.ts)
// - Loads @sentry/node ONLY if installed (zero-dep rule: absent in repo).
//   Present + DSN set → real capture; otherwise resolved no-op that still
//   returns the caller-supplied sentryId (filter persistence lane intact).
// - Every envelope is PII-scrubbed pre-delivery (Gate 4). Never throws.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { scrubPii } from '@repo/shared';

type SentryLike = {
  init?: (options: Record<string, unknown>) => void;
  captureException?: (error: unknown, hint?: Record<string, unknown>) => string;
};

function loadSentry(): SentryLike | null {
  try {
    const loader = eval('require') as (id: string) => SentryLike;
    return loader('@sentry/node');
  } catch {
    return null;
  }
}

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private readonly dsn = process.env['SENTRY_DSN'];
  private readonly sentry = loadSentry();
  private warned = false;

  constructor() {
    if (this.dsn && this.sentry?.init) {
      try {
        this.sentry.init({
          dsn: this.dsn,
          environment: process.env['NODE_ENV'] ?? 'development',
          tracesSampleRate: 0.1,
        });
      } catch (err) {
        this.logger.warn(`Sentry init fail-open: ${(err as Error).message}`);
      }
    }
  }

  /** True when a real Sentry backend is reachable (DSN + package). */
  isEnabled(): boolean {
    return Boolean(this.dsn && this.sentry);
  }

  /**
   * Capture a scrubbed incident envelope. Always resolves with a sentryId
   * (real SDK id when enabled, echoed envelope id otherwise).
   */
  async capture(envelope: Record<string, unknown>): Promise<{ sentryId: string }> {
    const fallbackId = String(envelope['sentryId'] ?? 'sentry-noop');
    try {
      const clean = scrubPii(envelope) as Record<string, unknown>;
      if (!this.isEnabled()) {
        if (!this.warned) {
          this.warned = true;
          this.logger.warn('Sentry DSN/package absent — incident envelope persisted locally only (zero-dep seam)');
        }
        return { sentryId: fallbackId };
      }
      const err = new Error(String(clean['errorMessage'] ?? 'incident'));
      err.name = String(clean['exceptionClass'] ?? 'Error');
      const id =
        this.sentry?.captureException?.(err, { extra: clean }) ?? fallbackId;
      return { sentryId: String(id || fallbackId) };
    } catch (err) {
      this.logger.warn(`Sentry capture fail-open: ${(err as Error).message}`);
      return { sentryId: fallbackId };
    }
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { SentryService as SentryServiceService };
