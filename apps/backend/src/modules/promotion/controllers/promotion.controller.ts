// SSOT Phase 088 — Promotion REST (quote/eligible/balance + admin seed)
// Canonical: apps/backend/src/modules/promotion/controllers/promotion.controller.ts
// (legacy class name PromotionControllerController renamed — no importers.)
// - POST calculate (JWT+Tenant, 5-tries guard inside) / GET eligible /
//   GET points-balance / POST admin/coupons (seed, admin role).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { DiscountCalculatorService } from '../services/discount-calculator.service';
import { CouponService } from '../services/coupon.service';
import { PointsService } from '../services/points.service';
import { PrismaService } from '../../../infra/database/prisma.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

function actorOf(req: LooseReq): { id: string; role?: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, ...(user.role ? { role: user.role } : {}) };
}

@Controller('api/v1/promotion')
export class PromotionController {
  constructor(
    private readonly calc: DiscountCalculatorService,
    private readonly coupons: CouponService,
    private readonly points: PointsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('calculate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  calculate(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as {
      cartId?: string; shopCouponCode?: string; freeShippingCouponCode?: string;
      redeemPoints?: number; items?: Array<{ productId: string; price: number; quantity: number }>;
      shippingFee?: number;
    };
    if (!b.cartId) throw new BadRequestException('Missing cartId');
    return this.calc.calculateStackableDiscount({
      tenantId: tenantOf(req),
      userId: actorOf(req).id,
      cartId: b.cartId,
      body: {
        ...(b.shopCouponCode ? { shopCouponCode: b.shopCouponCode } : {}),
        ...(b.freeShippingCouponCode ? { freeShippingCouponCode: b.freeShippingCouponCode } : {}),
        redeemPoints: b.redeemPoints ?? 0,
      },
      items: b.items ?? [],
      shippingFee: b.shippingFee ?? 0,
    });
  }

  @Get('eligible')
  @UseGuards(JwtAuthGuard, TenantGuard)
  eligible(@Req() req: LooseReq, @Query('subtotal') subtotal: string | undefined) {
    void actorOf(req);
    return this.coupons.eligible(tenantOf(req), Number(subtotal) || 0);
  }

  @Get('points-balance')
  @UseGuards(JwtAuthGuard, TenantGuard)
  balance(@Req() req: LooseReq) {
    return this.points.balance(actorOf(req).id).then((points) => ({ points }));
  }

  @Post('admin/coupons')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async seedCoupon(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = actorOf(req);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) {
      throw new ForbiddenException('Coupon seeding requires an admin role');
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b['code'] !== 'string' || typeof b['couponType'] !== 'string') {
      throw new BadRequestException('Invalid coupon seed');
    }
    const db = this.prisma as unknown as {
      coupon: { create(a: unknown): Promise<{ id: string; code: string }> };
    };
    const row = await db.coupon.create({
      data: {
        tenantId: tenantOf(req),
        code: (b['code'] as string).toUpperCase(),
        title: String(b['title'] ?? b['code']),
        ...(typeof b['description'] === 'string' ? { description: b['description'] } : {}),
        couponType: b['couponType'],
        scope: typeof b['scope'] === 'string' ? b['scope'] : 'GLOBAL',
        discountValue: Number(b['discountValue'] ?? 0),
        ...(b['maxDiscountAmount'] != null ? { maxDiscountAmount: Number(b['maxDiscountAmount']) } : {}),
        minOrderAmount: Number(b['minOrderAmount'] ?? 0),
        totalQuota: Number(b['totalQuota'] ?? 0),
        perUserLimit: Number(b['perUserLimit'] ?? 1),
        startAt: new Date(String(b['startAt'] ?? new Date().toISOString())),
        expireAt: new Date(String(b['expireAt'] ?? new Date(Date.now() + 86400_000).toISOString())),
        isActive: b['isActive'] !== false,
      },
    });
    return { id: row.id, code: row.code };
  }
}
