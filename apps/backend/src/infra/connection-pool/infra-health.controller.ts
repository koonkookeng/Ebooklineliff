// SSOT Phase 125 Task 4 §5.1 — real-time infra health webhook (shell)
// Canonical: apps/backend/src/infra/connection-pool/infra-health.controller.ts
// (legacy src/backend/infra/connection-pool/infra-health.controller.ts)
// - Thin decorator shell over InfraHealthService (123 precedent).
//   Public lane (probes carry no user context; rows expose status/lag
//   only — never connection strings, Gate 4).
// - Zero new deps.
import { Controller, Get, Query } from '@nestjs/common';
import { InfraHealthService, toPublicRow } from './infra-health.service';

export { toPublicRow };

@Controller('api/v1/infra')
export class InfraHealthController {
  constructor(private readonly health: InfraHealthService) {}

  @Get('health')
  healthCheck(@Query('region') region: string | undefined) {
    return this.health.health(region);
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { InfraHealthController as InfraHealthControllerController };
