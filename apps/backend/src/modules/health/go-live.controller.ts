// SSOT Phase 130 §5.2 — Kubernetes liveness/readiness probes (redacted)
// Canonical: apps/backend/src/modules/health/go-live.controller.ts
// (legacy src/backend/modules/health/* — 001 HealthController untouched)
// - GET /healthz/live (no deps, instant) + GET /healthz/readiness
//   (db+redis pings via GoLiveAuditService). Envelopes carry no hosts,
//   DSNs, or secrets (Gate 4).
// - CRITICAL_FAILURE must return HTTP 503: Kubernetes only looks at the
//   status code, so a 200 with a critical envelope would keep a broken pod
//   in the Service and black-hole traffic during cutover. DEGRADED stays
//   200 (cached reads still serve). Zero new deps.
import { Controller, Get, Res } from '@nestjs/common';
import { GoLiveAuditService, type ReadinessCheck } from './go-live-audit.service';

interface StatusSink {
  status(code: number): void;
}

@Controller('healthz')
export class GoLiveController {
  constructor(private readonly audit: GoLiveAuditService) {}

  @Get('live')
  live(): { status: string; checkedAt: string } {
    return { status: 'ok', checkedAt: new Date().toISOString() };
  }

  @Get('readiness')
  async readiness(@Res({ passthrough: true }) res: StatusSink): Promise<ReadinessCheck> {
    const probe = await this.audit.readiness();
    if (probe.status === 'CRITICAL_FAILURE') res.status(503);
    return probe;
  }
}
