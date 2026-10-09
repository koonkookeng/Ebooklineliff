// SSOT Phase 087 — Flash sale admin REST (campaign control + sweep)
// Canonical: apps/backend/src/modules/flash-sale/controllers/flash-sale-admin.controller.ts
// (legacy class name FlashSaleAdminControllerController renamed — no importers.)
// - POST campaigns / POST campaigns/:id/status (admin) / POST admin/sweep.
// - Zero new deps.
import { Body, Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { FlashSaleCampaignService } from '../services/flash-sale-campaign.service';
import { ReservationCleanupService } from '../services/reservation-cleanup.cron';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

function adminRoleOf(req: LooseReq): string {
  const user = (req['user'] as { role?: string } | undefined) ?? {};
  if (!user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('Flash campaign management requires an admin role');
  }
  return user.role;
}

@Controller('api/v1/flash-sale')
export class FlashSaleAdminController {
  constructor(
    private readonly campaigns: FlashSaleCampaignService,
    private readonly cleanup: ReservationCleanupService,
  ) {}

  @Post('admin/campaigns')
  @UseGuards(JwtAuthGuard, TenantGuard)
  createCampaign(@Req() req: LooseReq, @Body() body: {
    tenantId: string; title: string; description?: string; startTime: string; endTime: string;
    items: Array<{ productId: string; flashPrice: number; allocatedStock: number; maxPerUser?: number }>;
  }) {
    return this.campaigns.createCampaign(adminRoleOf(req), body);
  }

  @Post('admin/campaigns/:id/status')
  @UseGuards(JwtAuthGuard, TenantGuard)
  setStatus(@Req() req: LooseReq, @Param('id') id: string, @Body() body: { status: 'PAUSED' | 'ACTIVE' | 'ENDED' }) {
    return this.campaigns.setStatus(adminRoleOf(req), id, body.status);
  }

  @Post('admin/sweep')
  @UseGuards(JwtAuthGuard, TenantGuard)
  sweep(@Req() req: LooseReq) {
    adminRoleOf(req);
    return this.cleanup.releaseExpired();
  }
}
