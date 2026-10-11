// SSOT Phase 121 Task 6 §7.1 — Prometheus scrape lane (GET /metrics)
// Canonical: apps/backend/src/infra/observability/metrics.controller.ts
// - Public scrape endpoint (no auth guard: Prometheus scrapes without user
//   context; tenant cardinality stays label-side). Emits the spec trio
//   (http_request_duration_seconds / slip_verification_latency_seconds /
//   liff_canvas_ram_usage_bytes) via MetricsService.expose().
// - Fail-open: never throws (empty exposition on error). Zero new deps.
import { Controller, Get, Header, Logger } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): string {
    try {
      return this.metrics.expose();
    } catch (err) {
      this.logger.warn(`Metrics exposition fail-open: ${(err as Error).message}`);
      return '# metrics unavailable\n';
    }
  }
}
