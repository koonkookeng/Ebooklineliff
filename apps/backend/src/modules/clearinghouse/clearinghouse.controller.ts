// SSOT Phase 114 Tasks 2/4 — clearinghouse REST (dual-guard lane)
// Canonical: apps/backend/src/modules/clearinghouse/clearinghouse.controller.ts
// - GET summary (admin/finance) / GET ledger (paginated) / POST settle
//   (VERIFIED orders, idempotent) / POST payout (KYC-gated, min 100) /
//   POST reconcile (statement batch) / GET seller-balance (self).
// - RISK_CALL: no dedicated controllers exist in the spec §5 tree — this
//   thin transport serves the 114 frontend + proxies (all prior phases are
//   dual REST/GQL). Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ClearinghouseService } from './clearinghouse.service';
import { PayoutProcessorService } from './payout-processor.service';
import { ReconciliationEngineService } from './reconciliation-engine.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

function actorOf(req: LooseReq): { id: string; role: string | undefined } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, role: user.role };
}

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default';
}

function adminOf(req: LooseReq): { id: string; role: string } {
  const a = actorOf(req);
  if (!a.role || !ADMIN_ROLES.has(a.role)) throw new ForbiddenException('Clearinghouse requires a finance admin role');
  return { id: a.id, role: a.role };
}

@Controller('api/v1/clearinghouse')
export class ClearinghouseController {
  constructor(
    private readonly clearing: ClearinghouseService,
    private readonly payout: PayoutProcessorService,
    private readonly recon: ReconciliationEngineService,
  ) {}

  @Get('summary')
  @UseGuards(JwtAuthGuard, TenantGuard)
  summary(@Req() req: LooseReq) {
    adminOf(req);
    return this.clearing.getSummary(tenantOf(req));
  }

  @Get('ledger')
  @UseGuards(JwtAuthGuard, TenantGuard)
  ledger(
    @Req() req: LooseReq,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    adminOf(req);
    return this.clearing.getLedgerEntries(tenantOf(req), limit ? Number(limit) : 20, offset ? Number(offset) : 0);
  }

  @Post('settle')
  @UseGuards(JwtAuthGuard, TenantGuard)
  settle(@Req() req: LooseReq, @Body() body: unknown) {
    adminOf(req);
    const b = (body ?? {}) as { orderId?: string };
    if (!b.orderId) throw new BadRequestException('Missing orderId');
    return this.clearing.processOrderSettlement(b.orderId, tenantOf(req));
  }

  @Post('payout')
  @UseGuards(JwtAuthGuard, TenantGuard)
  requestPayout(@Req() req: LooseReq, @Body() body: unknown) {
    return this.payout.requestSellerPayout(actorOf(req), body, tenantOf(req));
  }

  @Get('seller-balance')
  @UseGuards(JwtAuthGuard, TenantGuard)
  sellerBalance(@Req() req: LooseReq) {
    return this.payout.settledBalance(actorOf(req).id);
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard, TenantGuard)
  reconcile(@Req() req: LooseReq, @Body() body: unknown) {
    adminOf(req);
    const b = (body ?? {}) as { lines?: Array<{ orderId: string; amount: number; transRef?: string }> };
    if (!Array.isArray(b.lines)) throw new BadRequestException('Missing lines');
    return this.recon.reconcileBatch(tenantOf(req), b.lines);
  }
}
