// SSOT Phase 124 Task 2 §5.1 — chaos admin REST (drill control plane)
// Canonical: apps/backend/src/modules/chaos/chaos.controller.ts
// (legacy src/backend/modules/chaos/chaos.controller.ts)
// - POST inject/reset + GET faults/status. SUPER_ADMIN only (fault
//   injection is the most privileged lane). Thin delegation to the
//   injector + 122 breaker status (no logic duplication).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ChaosInjectionPayloadSchema, type ChaosFaultType } from '@repo/shared';
import { ChaosInjectorService } from './chaos-injector.service';
import { CircuitBreakerService } from '../resilience/services/circuit-breaker.service';

type LooseReq = Record<string, unknown>;

function superAdminOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id || user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Chaos drills require SUPER_ADMIN');
  return user.id;
}

@Controller('api/v1/admin/chaos')
export class ChaosController {
  constructor(
    private readonly chaos: ChaosInjectorService,
    private readonly breaker: CircuitBreakerService,
  ) {}

  @Post('inject')
  @UseGuards(JwtAuthGuard, TenantGuard)
  inject(@Req() req: LooseReq, @Body() body: Record<string, unknown>) {
    const userId = superAdminOf(req);
    const parsed = ChaosInjectionPayloadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid chaos injection payload');
    return this.chaos.inject(parsed.data, userId);
  }

  @Post('reset')
  @UseGuards(JwtAuthGuard, TenantGuard)
  reset(@Req() req: LooseReq, @Body() body: { targetService?: string }) {
    superAdminOf(req);
    if (!body?.targetService) throw new BadRequestException('targetService required');
    return this.chaos.reset(body.targetService).then((reset) => ({ reset }));
  }

  @Get('faults')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async faults(@Req() req: LooseReq, @Query('service') service: string | undefined) {
    superAdminOf(req);
    if (!service) throw new BadRequestException('service required');
    return { service, fault: await this.chaos.activeFault(service) };
  }

  @Get('breaker-status')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async breakerStatus(@Req() req: LooseReq, @Query('service') service: string | undefined) {
    superAdminOf(req);
    if (!service) throw new BadRequestException('service required');
    return { serviceName: service, state: await this.breaker.getState(service) };
  }

  @Post('drain-outbox')
  @UseGuards(JwtAuthGuard, TenantGuard)
  drainOutbox(@Req() req: LooseReq) {
    superAdminOf(req);
    // The worker is cadence-owned (cron/starter lane); this endpoint only
    // reports drill readiness — draining stays out of the request path.
    return { queued: true as const, note: 'outbox drain runs on the worker cadence' };
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { ChaosController as ChaosControllerController };
