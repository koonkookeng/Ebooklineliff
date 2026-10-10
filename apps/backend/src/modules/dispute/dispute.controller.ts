// SSOT Phase 113 Task 4 §5.1 — dispute buyer REST (LIFF self lane)
// Canonical: apps/backend/src/modules/dispute/dispute.controller.ts
// (legacy src/backend/modules/dispute/dispute.controller.ts)
// - POST claim (JWT, in-window, ≥1 evidence) / POST cancel (owner) /
//   GET by-order (owner/seller/admin). Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DisputeService } from './dispute.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { id: string; role: string | undefined } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, role: user.role };
}

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default';
}

@Controller('api/v1/disputes')
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Post('claim')
  @UseGuards(JwtAuthGuard, TenantGuard)
  claim(@Req() req: LooseReq, @Body() body: unknown) {
    return this.disputes.createDisputeClaim(actorOf(req).id, body, tenantOf(req));
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard, TenantGuard)
  cancel(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { disputeId?: string };
    if (!b.disputeId) throw new BadRequestException('Missing disputeId');
    return this.disputes.cancelDispute(actorOf(req).id, b.disputeId);
  }

  @Get('by-order')
  @UseGuards(JwtAuthGuard, TenantGuard)
  byOrder(@Req() req: LooseReq, @Query('orderId') orderId: string | undefined) {
    if (!orderId) throw new BadRequestException('Missing orderId');
    return this.disputes.getByOrder(orderId, actorOf(req));
  }
}
