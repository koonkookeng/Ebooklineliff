// SSOT Phase 084 Task 3 — Abandoned cart REST (mark/recover/analytics/sweep)
// Canonical: apps/backend/src/modules/messaging/controllers/abandoned-cart.controller.ts
// (legacy class name AbandonedCartControllerController renamed — no importers).
// - POST mark-abandoned / POST recover (public magic-link) / GET analytics
//   (JWT) / POST admin/sweep (admin role, Task 4 cron-ready).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { AbandonedCartService } from '../services/abandoned-cart.service';
import { AbandonedCartProcessor } from '../queues/abandoned-cart.processor';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { id: string; role?: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, ...(user.role ? { role: user.role } : {}) };
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

@Controller('api/v1/abandoned-cart')
export class AbandonedCartController {
  constructor(
    private readonly carts: AbandonedCartService,
    private readonly processor: AbandonedCartProcessor,
  ) {}

  @Post('mark-abandoned')
  @UseGuards(JwtAuthGuard, TenantGuard)
  markAbandoned(@Req() req: LooseReq, @Body() body: unknown) {
    const cartId = (body as { cartId?: string } | null)?.cartId;
    if (!cartId) throw new BadRequestException('Missing cartId');
    return this.carts.markAbandoned(actorOf(req).id, cartId);
  }

  @Post('recover')
  async recover(@Body() body: unknown) {
    const token = (body as { recoveryToken?: string } | null)?.recoveryToken;
    if (!token) throw new BadRequestException('Missing recoveryToken');
    const secret = process.env['RECOVERY_TOKEN_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz';
    return this.carts.recover(token, secret);
  }

  @Get('analytics')
  @UseGuards(JwtAuthGuard, TenantGuard)
  analytics(@Req() req: LooseReq, @Query('tenantId') tenantId: string | undefined) {
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const tenant = (tenantId ?? headers['x-tenant-id'] ?? 'default').trim();
    return this.carts.analytics(tenant);
  }

  @Post('admin/sweep')
  @UseGuards(JwtAuthGuard, TenantGuard)
  sweep(@Req() req: LooseReq, @Query('step') step: string | undefined) {
    const actor = actorOf(req);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) {
      throw new ForbiddenException('Sweep requires admin role');
    }
    const s = step === 'STEP_2_3_HOURS' ? 'STEP_2_3_HOURS' : 'STEP_1_15_MIN';
    return this.processor.drainDue(s as 'STEP_1_15_MIN' | 'STEP_2_3_HOURS');
  }
}
