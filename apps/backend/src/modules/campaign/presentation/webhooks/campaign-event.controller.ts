// SSOT Phase 117 Task 4 §7.1 — campaign event bridge (JWT intake → stream)
// Canonical: apps/backend/src/modules/campaign/presentation/webhooks/campaign-event.controller.ts
// (legacy src/backend/modules/campaign/presentation/webhooks/campaign-event.controller.ts)
// - POST track (coupon_validated/claimed/redeemed analytics fan-out, §7.1) /
//   GET active (tenant campaign list for LIFF). JWT-guarded. Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { PrismaCouponRepository } from '../../infrastructure/persistence/prisma-coupon.repository';
import { CouponCacheRepository } from '../../infrastructure/redis/coupon-cache.repository';
import { CouponStackService } from '../../application/services/coupon-stack.service';
import { ValidateCouponUseCase } from '../../application/use-cases/validate-coupon.use-case';
import { ClaimCouponUseCase } from '../../application/use-cases/claim-coupon.use-case';

type LooseReq = Record<string, unknown>;

const TRACKED = new Set(['coupon_validated', 'coupon_claimed', 'coupon_redeemed', 'coupon_expired_view']);

@Controller('api/v1/campaigns')
export class CampaignEventController {
  constructor(
    private readonly store: PrismaCouponRepository,
    private readonly cache: CouponCacheRepository,
    private readonly stack: CouponStackService,
    private readonly validate: ValidateCouponUseCase,
    private readonly claim: ClaimCouponUseCase,
  ) {}

  private actorOf(req: LooseReq): string {
    const user = (req['user'] as { id?: string } | undefined) ?? {};
    if (!user.id) throw new BadRequestException('Missing authentication');
    return user.id;
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  validateCoupon(@Req() req: LooseReq, @Body() body: unknown) {
    return this.validate.execute(body, this.actorOf(req));
  }

  @Post('claim')
  @UseGuards(JwtAuthGuard, TenantGuard)
  claimCoupon(@Req() req: LooseReq, @Body() body: unknown) {
    return this.claim.execute(body, this.actorOf(req));
  }

  @Get('active')
  @UseGuards(JwtAuthGuard, TenantGuard)
  active(@Req() req: LooseReq) {
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const tenant = headers['x-tenant-slug'] ?? headers['x-tenant-identifier'];
    return this.store.activeCampaigns(tenant);
  }

  @Post('track')
  @UseGuards(JwtAuthGuard, TenantGuard)
  track(@Body() body: unknown) {
    const b = (body ?? {}) as { event?: string; fields?: Record<string, string | number> };
    if (!b.event || !TRACKED.has(b.event)) throw new BadRequestException('Unknown campaign event');
    return this.cache.publish(b.event, b.fields ?? {}).then(() => ({ tracked: true }));
  }

  @Get('lookup')
  @UseGuards(JwtAuthGuard, TenantGuard)
  lookup(@Query('code') code: string | undefined) {
    if (!code) throw new BadRequestException('Missing code');
    return this.store.findByCode(code.toUpperCase().trim());
  }

  @Post('stack')
  @UseGuards(JwtAuthGuard, TenantGuard)
  stackCoupons(@Req() req: LooseReq, @Body() body: unknown) {
    const user = (req['user'] as { id?: string } | undefined) ?? {};
    if (!user.id) throw new BadRequestException('Missing authentication');
    const b = (body ?? {}) as { codes?: string[]; cartItems?: Array<Record<string, unknown>>; shippingFee?: number };
    if (!b.codes || !b.cartItems) throw new BadRequestException('Missing codes/cartItems');
    return this.stack.applyStack(user.id, {
      codes: b.codes,
      cartItems: b.cartItems as Parameters<CouponStackService['applyStack']>[1]['cartItems'],
      ...(typeof b.shippingFee === 'number' ? { shippingFee: b.shippingFee } : {}),
    });
  }
}
