// SSOT Phase 121 Tasks 1/3/6 §5.1/§7.1 — observability composition module
// Canonical: apps/backend/src/infra/observability/observability.module.ts
// - Composes the Task 1 OTel SDK seam (bootstrap-owned, no provider),
//   Task 3 PinoLoggerService, Task 6 MetricsService + /metrics scrape lane,
//   and Task 2 SentryModule (lazy wrapper). TelemetryInterceptor (Task 4)
//   and SentryExceptionFilter (Task 2) stay opt-in per-controller globals
//   (no APP_* side effects in this phase — surgical scope discipline).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { SentryModule } from '../sentry/sentry.module';
import { PinoLoggerService } from '../logger/pino-logger.service';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [SentryModule],
  controllers: [MetricsController],
  providers: [MetricsService, PinoLoggerService],
  exports: [MetricsService, PinoLoggerService, SentryModule],
})
export class ObservabilityModule {}
