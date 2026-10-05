// SSOT Phase 001 §5 — health service
import { Injectable } from '@nestjs/common';
import type { HealthCheckResponse } from '@repo/shared';

@Injectable()
export class HealthService {
  check(tenantContext?: string): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      engine: 'Fastify Engine',
      version: '1.0.0',
      ...(tenantContext ? { tenantContext } : {}),
    };
  }
}
