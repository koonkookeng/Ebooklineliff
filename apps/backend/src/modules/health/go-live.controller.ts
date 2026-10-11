// SSOT Phase 130 §5.2 — Kubernetes liveness/readiness probes (redacted)
// Canonical: apps/backend/src/modules/health/go-live.controller.ts
// (legacy src/backend/modules/health/* — 001 HealthController untouched)
// - GET /healthz/live (no deps, instant) + GET /healthz/readiness
//   (db+redis pings via GoLiveAuditService). Envelopes carry no hosts,
//   DSNs, or secrets (Gate 4). Zero new deps.
import { Controller, Get } from '@nestjs/common';
import { GoLiveAuditService } from './go-live-audit.service';

@Controller('healthz')
export class GoLiveController {
  constructor(private readonly audit: GoLiveAuditService) {}

  @Get('live')
  live(): { status: string; checkedAt: string } {
    return { status: 'ok', checkedAt: new Date().toISOString() };
  }

  @Get('readiness')
  readiness() {
    return this.audit.readiness();
  }
}
