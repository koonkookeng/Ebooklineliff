// SSOT Phase 086 — Payout clearing REST (request/queue/approve)
// Canonical: apps/backend/src/modules/payout/controllers/payout.controller.ts
// (ADDITIVE to the §5.1 tree: LIFF clients ride zero-dep REST proxies —
// 080–085 precedent. GQL intents stay canonical in resolvers/.)
// - POST request (JWT+Tenant, KYC-gated + locked) / GET clearing-queue /
//   POST clearing-approve (admin role, ≤100/batch).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { RequestPayoutUseCase } from '../application/use-cases/request-payout.use-case';
import { ProcessBatchClearingUseCase } from '../application/use-cases/process-batch-clearing.use-case';
import { PrismaClearingStore } from '../infrastructure/clearing.store';

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

function netOf(req: LooseReq): { ipAddress: string } {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return { ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0') };
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

@Controller('api/v1/payout')
export class PayoutController {
  constructor(
    private readonly request: RequestPayoutUseCase,
    private readonly clearing: ProcessBatchClearingUseCase,
    private readonly store: PrismaClearingStore,
  ) {}

  @Post('request')
  @UseGuards(JwtAuthGuard, TenantGuard)
  requestPayout(@Req() req: LooseReq, @Body() body: unknown) {
    return this.request.execute({
      tenantId: tenantOf(req),
      actorUserId: actorOf(req).id,
      body,
      net: netOf(req),
    });
  }

  @Get('clearing-queue')
  @UseGuards(JwtAuthGuard, TenantGuard)
  queue(@Req() req: LooseReq) {
    const actor = actorOf(req);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) {
      throw new ForbiddenException('Clearing queue requires a finance admin role');
    }
    return this.store.approvalQueue(tenantOf(req));
  }

  @Post('clearing-approve')
  @UseGuards(JwtAuthGuard, TenantGuard)
  approve(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = actorOf(req);
    const ids = ((body as { payoutIds?: unknown } | null)?.payoutIds ?? []) as string[];
    return this.clearing.approveBatch({
      tenantId: tenantOf(req),
      actorUserId: actor.id,
      ...(actor.role ? { role: actor.role } : {}),
      payoutIds: ids,
    });
  }
}
