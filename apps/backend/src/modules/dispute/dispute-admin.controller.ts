// SSOT Phase 113 Task 7 §5.1 — dispute admin arbitration REST
// Canonical: apps/backend/src/modules/dispute/dispute-admin.controller.ts
// - GET queue (open/refunded counters) / POST resolve (atomic verdict) /
//   POST begin (pull into arbitration) — admin roles only. Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DisputeService } from './dispute.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

function adminOf(req: LooseReq): { id: string; role: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id || !user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('Dispute arbitration requires an admin role');
  }
  return { id: user.id, role: user.role };
}

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default';
}

@Controller('api/v1/admin/disputes')
export class DisputeAdminController {
  constructor(private readonly disputes: DisputeService) {}

  @Get('queue')
  @UseGuards(JwtAuthGuard, TenantGuard)
  queue(
    @Req() req: LooseReq,
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const actor = adminOf(req);
    return this.disputes.getQueue(actor.role, {
      ...(status ? { status } : {}),
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('begin')
  @UseGuards(JwtAuthGuard, TenantGuard)
  begin(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    const b = (body ?? {}) as { disputeId?: string };
    if (!b.disputeId) throw new BadRequestException('Missing disputeId');
    return this.disputes.beginArbitration(actor.id, actor.role, b.disputeId);
  }

  @Post('resolve')
  @UseGuards(JwtAuthGuard, TenantGuard)
  resolve(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    return this.disputes.resolveArbitration(actor, body, tenantOf(req));
  }
}
