// SSOT Phase 087 — Flash sale customer REST (campaign read + reserve)
// Canonical: apps/backend/src/modules/flash-sale/controllers/flash-sale.controller.ts
// (ADDITIVE to the §5.1 tree: LIFF clients ride zero-dep REST proxies —
// 080–086 precedent. GQL intents stay canonical in resolvers/.)
// - GET campaign (public) / POST reserve (JWT, 1-per-3s inside the lock).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ReserveStockInputSchema } from '@repo/shared';
import { FlashSaleCampaignService } from '../services/flash-sale-campaign.service';
import { RedisStockLockService } from '../services/redis-stock-lock.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/flash-sale')
export class FlashSaleController {
  constructor(
    private readonly campaigns: FlashSaleCampaignService,
    private readonly locks: RedisStockLockService,
  ) {}

  @Get('campaign')
  campaign(@Query('tenantId') tenantId: string | undefined) {
    return this.campaigns.activeCampaign((tenantId ?? 'default').trim());
  }

  @Post('reserve')
  @UseGuards(JwtAuthGuard, TenantGuard)
  reserve(@Req() req: LooseReq, @Body() body: unknown) {
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const parsed = ReserveStockInputSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: headers['x-tenant-id'] ?? 'default',
    });
    if (!parsed.success) throw new BadRequestException('Invalid reserve input');
    return this.locks.reserveStockAtomic({
      campaignId: parsed.data.campaignId,
      productId: parsed.data.productId,
      userId: actorOf(req),
      quantity: parsed.data.quantity,
    });
  }
}
