// SSOT Phase 010 §5.1 — Storefront REST (Next.js fetch path: feed + PDP + predictive)
// Canonical: apps/backend/src/modules/catalog/presentation/rest/storefront.controller.ts
import { Controller, Get, Param, Query, Req, BadRequestException } from '@nestjs/common';
import { StorefrontService } from '../../services/storefront.service';

interface ReqLike {
  headers: Record<string, string | string[] | undefined>;
}

function headerTenant(req: ReqLike, fallback?: string): string {
  const h = req.headers['x-tenant-id'];
  const v = Array.isArray(h) ? h[0] : h;
  const t = v ?? fallback;
  if (!t) throw new BadRequestException('Missing tenant id');
  return t;
}

@Controller('api/storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('feed')
  feed(@Query('tenantId') tenantId: string | undefined, @Req() req: ReqLike) {
    return this.storefront.getFeedByTenant(headerTenant(req, tenantId));
  }

  @Get('pdp/:slug')
  pdp(@Param('slug') slug: string, @Query('tenantId') tenantId: string | undefined, @Req() req: ReqLike) {
    const h = req.headers['x-tenant-id'];
    const t = (Array.isArray(h) ? h[0] : h) ?? tenantId;
    return this.storefront.getProductBySlug(slug, t);
  }

  @Get('predictive')
  predictive(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string | undefined,
    @Req() req: ReqLike,
  ) {
    const h = req.headers['x-tenant-id'];
    const t = (Array.isArray(h) ? h[0] : h) ?? tenantId;
    return this.storefront.getPredictiveSearch(q, t);
  }
}
