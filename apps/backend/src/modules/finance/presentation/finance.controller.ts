// SSOT Phase 081 §3.2/Task 6 — Finance REST (overview/statements/payout/SSE/reconcile)
// Canonical: apps/backend/src/modules/finance/presentation/finance.controller.ts
// - GET overview / GET statements (JWT+Tenant, sharer-self scope).
// - POST payout (JWT+Tenant, Redis mutex inside the service).
// - GET stream-balance (SSE: instant snapshot + 5s ledger cadence; the
//   <300ms server-side push rides the wallet stream on every posting).
// - POST admin/approve-payout + GET admin/reconcile (admin role; reconcile
//   is the §10.1 daily probe — wire your scheduler to it, no new deps).
// - Zero new deps (rxjs already a backend dep).
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { interval, map, startWith, switchMap } from 'rxjs';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { BalanceCalculatorService } from '../application/balance-calculator.service';
import { FinancePayoutService } from '../application/payout.service';

type LooseReq = Record<string, unknown>;

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

function actorOf(req: LooseReq): { id: string; role?: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, ...(user.role ? { role: user.role } : {}) };
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

@Controller('api/v1/finance')
export class FinanceController {
  constructor(
    private readonly balances: BalanceCalculatorService,
    private readonly payouts: FinancePayoutService,
  ) {}

  @Get('overview')
  @UseGuards(JwtAuthGuard, TenantGuard)
  overview(@Req() req: LooseReq) {
    return this.balances.overview(actorOf(req).id);
  }

  @Get('statements')
  @UseGuards(JwtAuthGuard, TenantGuard)
  statements(
    @Req() req: LooseReq,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    return this.balances.statements(
      actorOf(req).id,
      Math.min(Number(limit) || 20, 100),
      Math.max(Number(offset) || 0, 0),
    );
  }

  @Post('payout')
  @UseGuards(JwtAuthGuard, TenantGuard)
  payout(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!b['bankAccountId']) throw new BadRequestException('Missing bankAccountId');
    return this.payouts.requestPayout({
      tenantId: tenantOf(req),
      actorUserId: actorOf(req).id,
      body,
      bankSnapshot: {
        bankName: String(b['bankName'] ?? ''),
        accountNumber: String(b['bankAccountNumber'] ?? ''),
        accountName: String(b['bankAccountName'] ?? ''),
      },
      identity: {
        taxId: String(b['taxId'] ?? ''),
        payeeName: String(b['payeeName'] ?? ''),
        payeeAddress: String(b['payeeAddress'] ?? ''),
      },
    });
  }

  @Sse('stream-balance')
  @UseGuards(JwtAuthGuard, TenantGuard)
  streamBalance(@Req() req: LooseReq) {
    const userId = actorOf(req).id;
    return interval(5000).pipe(
      startWith(0),
      switchMap(() => this.balances.overview(userId)),
      map((snapshot) => ({ data: snapshot }) as { data: unknown }),
    );
  }

  @Post('admin/approve-payout/:payoutId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  approvePayout(@Req() req: LooseReq, @Param('payoutId') payoutId: string) {
    const actor = actorOf(req);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) {
      throw new ForbiddenException('Payout approval requires admin role');
    }
    return this.payouts.approvePayout(payoutId, true);
  }

  @Get('admin/reconcile')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async reconcile(@Req() req: LooseReq) {
    const actor = actorOf(req);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) {
      throw new ForbiddenException('Reconciliation requires admin role');
    }
    const discrepancy = await this.balances.checkSystemWideDiscrepancy();
    return {
      discrepancy,
      healthy: discrepancy === 0,
      payoutsPaused: discrepancy !== 0,
      checkedAt: new Date().toISOString(),
    };
  }
}
