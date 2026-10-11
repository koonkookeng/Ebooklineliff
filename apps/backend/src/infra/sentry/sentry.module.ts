// SSOT Phase 121 Task 2 §5.1 — NestJS Sentry integration module
// Canonical: apps/backend/src/infra/sentry/sentry.module.ts
// (legacy src/backend/infra/sentry/sentry.module.ts)
// - Provides + exports SentryService (lazy zero-dep wrapper). Imported by
//   ObservabilityModule; the global SentryExceptionFilter stays constructor-
//   injected with Prisma/Redis (no cycle: this module owns no persistence).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { SentryService } from './sentry.service';

@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryModule {}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { SentryModule as SentryModuleModule };
