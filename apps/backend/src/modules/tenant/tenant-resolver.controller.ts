// SSOT Phase 071 §3.2/§6 — Public tenant resolve + branding REST
// Canonical: apps/backend/src/modules/tenant/tenant-resolver.controller.ts
// - GET /api/v1/tenant/resolve?identifier=<slug|custom:host|default>
//   (Edge/LIFF pre-auth lookup; Zod-gated, fail-open 404 for unknown).
// - GET /api/v1/tenant/branding?tenantId=<uuid|default>
//   (§3.2 getTenantBranding intent over REST for LIFF first-ms hydration).
// - Public (no guard): branding is needed before auth. Zero new deps.
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { TenantBrandingSchema, TenantIdentifierSchema } from '@repo/shared';
import { TenantResolverService } from './tenant-resolver.service';

@Controller('api/v1/tenant')
export class TenantResolverController {
  constructor(private readonly tenants: TenantResolverService) {}

  @Get('resolve')
  async resolve(@Query('identifier') identifier?: string) {
    const parsed = TenantIdentifierSchema.safeParse((identifier ?? 'default').trim().toLowerCase() || 'default');
    if (!parsed.success) throw new BadRequestException('Invalid tenant identifier');
    return this.tenants.resolveTenantIdentifier(parsed.data);
  }

  @Get('branding')
  async branding(@Query('tenantId') tenantId?: string, @Query('tenantSlug') tenantSlug?: string) {
    const id = (tenantId ?? '').trim() || (tenantSlug ?? '').trim();
    if (!id) throw new BadRequestException('Missing tenantId or tenantSlug');
    const resolved = await this.tenants.resolveTenantIdentifier(id);
    const branding = await this.tenants.getBrandingConfig(resolved.tenantId);
    const parsed = TenantBrandingSchema.safeParse(branding);
    if (!parsed.success) throw new BadRequestException('Invalid branding payload');
    return parsed.data;
  }
}
