// SSOT Phase 001 §5 — GET /api/v1/health
import { Controller, Get, Headers } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  get(@Headers('x-tenant') tenant?: string) {
    return this.health.check(tenant);
  }
}
