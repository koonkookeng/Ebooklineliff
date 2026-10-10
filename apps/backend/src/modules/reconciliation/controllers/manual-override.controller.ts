// SSOT Phase 115 Task 5 §5.1 — manual override REST (dual control)
// Canonical: apps/backend/src/modules/reconciliation/controllers/manual-override.controller.ts
// (legacy src/backend/modules/reconciliation/controllers/manual-override.controller.ts)
// - POST initiate (maker) / POST approve (checker ≠ maker, designated pin) /
//   GET statements (queue) / GET kpi / GET verify-chain — finance roles only.
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ManualOverrideService } from '../services/manual-override.service';
import { AutoReconciliationEngineService } from '../services/auto-reconciliation-engine.service';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { autoMatchRate } from '@repo/shared';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

function adminOf(req: LooseReq): { id: string; role: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id || !user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('Reconciliation requires a finance admin role');
  }
  return { id: user.id, role: user.role };
}

function netOf(req: LooseReq): { ipAddress: string; userAgent: string; tenant: string } {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    userAgent: headers['user-agent'] ?? 'unknown',
    tenant: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'DEFAULT',
  };
}

@Controller('api/v1/admin/reconciliation')
export class ManualOverrideController {
  constructor(
    private readonly overrides: ManualOverrideService,
    private readonly engine: AutoReconciliationEngineService,
    private readonly repo: ReconciliationRepository,
  ) {}

  @Get('statements')
  @UseGuards(JwtAuthGuard, TenantGuard)
  statements(
    @Req() req: LooseReq,
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    adminOf(req);
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 50));
    return this.repo.listStatements({ status, skip: (p - 1) * l, take: l });
  }

  @Get('kpi')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async kpi(@Req() req: LooseReq) {
    adminOf(req);
    const counts = await this.repo.kpiCounts();
    return {
      totalStatementsCount: counts.total,
      autoMatchedRatePercentage: autoMatchRate(counts.auto, counts.total),
      totalMatchedAmount: 0,
      pendingDiscrepanciesCount: counts.pending,
      manualOverriddenCount: counts.overridden,
    };
  }

  @Get('verify-chain')
  @UseGuards(JwtAuthGuard, TenantGuard)
  verifyChain(@Req() req: LooseReq) {
    adminOf(req);
    return this.overrides.verifyChain();
  }

  @Post('csv-import')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async csvImport(@Req() req: LooseReq, @Body() body: unknown) {
    adminOf(req);
    const lines = (body as { lines?: unknown[] } | null)?.lines;
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
      throw new BadRequestException('lines must be a non-empty array (max 100)');
    }
    const net = netOf(req);
    const results = [];
    for (const line of lines) {
      try {
        results.push(await this.engine.processIncomingStatement(line, net.tenant));
      } catch (err) {
        results.push({ status: 'REJECTED', error: (err as Error).message });
      }
    }
    return { processed: results.length, results };
  }

  @Post('initiate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  initiate(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    return this.overrides.initiateOverride(actor, body, netOf(req), netOf(req).tenant);
  }

  @Post('approve')
  @UseGuards(JwtAuthGuard, TenantGuard)
  approve(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    const b = (body ?? {}) as { overrideId?: string; checkerUserId?: string };
    if (!b.overrideId) throw new BadRequestException('Missing overrideId');
    const net = netOf(req);
    return this.overrides.approveOverrideChecker(actor, b.overrideId, net, net.tenant, b.checkerUserId);
  }
}
