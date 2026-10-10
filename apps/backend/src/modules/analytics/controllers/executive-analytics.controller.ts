// SSOT Phase 116 Task 4 — executive BI REST (finance roles only)
// Canonical: apps/backend/src/modules/analytics/controllers/executive-analytics.controller.ts
// - GET summary (cache-first <500ms) / GET cohort / GET breakdown /
//   GET snapshots / POST snapshot-run (nightly worker, once).
// - Tenant isolation: header tenant wins (explicit per-read filter inside).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ExecutiveAnalyticsService } from '../services/executive-analytics.service';
import { DailySnapshotWorker } from '../workers/daily-snapshot.worker';

type LooseReq = Record<string, unknown>;

const FINANCE_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

function financeOf(req: LooseReq): void {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  if (!user.role || !FINANCE_ROLES.has(user.role)) {
    throw new ForbiddenException('Executive BI requires a finance admin role');
  }
}

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default';
}

@Controller('api/v1/admin/analytics')
export class ExecutiveAnalyticsController {
  constructor(
    private readonly bi: ExecutiveAnalyticsService,
    private readonly nightly: DailySnapshotWorker,
  ) {}

  @Get('summary')
  @UseGuards(JwtAuthGuard, TenantGuard)
  summary(@Req() req: LooseReq, @Query('timeRange') timeRange: string | undefined) {
    financeOf(req);
    return this.bi.getExecutiveKpiSummary(tenantOf(req), timeRange ?? 'LAST_30_DAYS');
  }

  @Get('cohort')
  @UseGuards(JwtAuthGuard, TenantGuard)
  cohort(@Req() req: LooseReq, @Query('months') months: string | undefined) {
    financeOf(req);
    return this.bi.getCohortMatrix(tenantOf(req), months ? Number(months) : 6);
  }

  @Get('breakdown')
  @UseGuards(JwtAuthGuard, TenantGuard)
  breakdown(@Req() req: LooseReq, @Query('timeRange') timeRange: string | undefined) {
    financeOf(req);
    return this.bi.getRevenueBreakdown(tenantOf(req), timeRange ?? 'LAST_30_DAYS');
  }

  @Post('snapshot-run')
  @UseGuards(JwtAuthGuard, TenantGuard)
  snapshotRun(@Req() req: LooseReq, @Body() body: unknown) {
    financeOf(req);
    const b = (body ?? {}) as { date?: string };
    return this.nightly.runOnce([tenantOf(req)], b.date ? new Date(b.date) : new Date());
  }
}
