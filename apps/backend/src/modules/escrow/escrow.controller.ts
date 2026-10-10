// SSOT Phase 113 Task 3 — escrow REST (hold + status)
// Canonical: apps/backend/src/modules/escrow/escrow.controller.ts
// - POST hold (JWT: buyer/system lane — idempotent per order) /
//   GET status (ownership-checked). Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { EscrowService } from './escrow.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { id: string; role: string | undefined } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, role: user.role };
}

@Controller('api/v1/escrow')
export class EscrowController {
  constructor(private readonly escrow: EscrowService) {}

  @Post('hold')
  @UseGuards(JwtAuthGuard, TenantGuard)
  hold(@Body() body: unknown) {
    const b = (body ?? {}) as { orderId?: string; sellerId?: string; grossAmount?: number; platformFee?: number };
    if (!b.orderId || !b.sellerId || typeof b.grossAmount !== 'number') {
      throw new BadRequestException('Missing orderId/sellerId/grossAmount');
    }
    return this.escrow.holdForOrder(b.orderId, { sellerId: b.sellerId, grossAmount: b.grossAmount, ...(typeof b.platformFee === 'number' ? { platformFee: b.platformFee } : {}) });
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, TenantGuard)
  status(@Req() req: LooseReq, @Query('orderId') orderId: string | undefined) {
    if (!orderId) throw new BadRequestException('Missing orderId');
    return this.escrow.getStatus(orderId, actorOf(req));
  }
}
