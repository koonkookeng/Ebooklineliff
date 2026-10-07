// SSOT Phase 029 Task 8 — Performance telemetry REST controller (beacon-first)
// Canonical: apps/backend/src/modules/performance/presentation/webhooks/performance-telemetry.controller.ts
// (legacy src/backend/modules/performance/.../performance-telemetry.controller.ts)
// - POST /api/v1/performance/telemetry — PUBLIC (sendBeacon carries no auth;
//   middleware bypasses this path). Zod-gated, append-only, always 200 true.
// - POST /api/v1/performance/prefetch — JWT-guarded predictive trigger.
// - GET  /api/v1/performance/bundle — public CI badge read (no PII in manifest).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { BundleGuardService } from '../../application/services/bundle-guard.service';
import { PredictivePrefetchService } from '../../application/services/predictive-prefetch.service';
import { PrismaPerformanceRepository } from '../../infrastructure/persistence/prisma-performance.repository';
import { PerformanceMetric } from '../../domain/entities/performance-metric.entity';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TelemetryIngestSchema, type PerformanceMetricType } from '@repo/shared';

interface AuthedReq {
  user?: { id?: string };
  headers?: Record<string, string | string[] | undefined>;
}

function userAgentOf(req: AuthedReq): string | undefined {
  const v = req.headers?.['user-agent'];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s.slice(0, 500) : undefined;
}

@Controller('api/v1/performance')
export class PerformanceTelemetryController {
  constructor(
    private readonly guard: BundleGuardService,
    private readonly prefetch: PredictivePrefetchService,
    private readonly repo: PrismaPerformanceRepository,
  ) {}

  @Post('telemetry')
  async ingest(@Body() body: unknown, @Req() req: AuthedReq) {
    const parsed = TelemetryIngestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid telemetry metric');
    const ua = userAgentOf(req);
    const metric = PerformanceMetric.create({
      tenantId: 'default',
      metricType: parsed.data.metricType as PerformanceMetricType,
      metricValue: parsed.data.value,
      route: parsed.data.route,
      ...(parsed.data.deviceMemory !== undefined ? { deviceMemory: parsed.data.deviceMemory } : {}),
      ...(parsed.data.effectiveType ? { effectiveType: parsed.data.effectiveType } : {}),
      ...(ua ? { userAgent: ua } : {}),
    });
    await this.repo.saveMetric(metric.props);
    return { success: true };
  }

  @Post('prefetch')
  @UseGuards(JwtAuthGuard)
  trigger(@Body() body: Record<string, unknown>, @Req() req: AuthedReq) {
    return this.prefetch.processPredictivePrefetch({ ...(body as object), userId: req.user?.id ?? 'anonymous' });
  }

  @Get('bundle')
  async latest() {
    const manifest = await this.guard.latest();
    if (!manifest) return { passed: false, status: 'NO_DATA' as const };
    const { passed, ...rest } = manifest;
    return { ...rest, passed, status: passed ? ('PASS' as const) : ('FAIL' as const) };
  }
}
