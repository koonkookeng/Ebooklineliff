// SSOT Phase 071 §3.2 — Tenant branding GraphQL intent (code-first)
// Canonical: apps/backend/src/api/graphql/tenant.resolver.ts
// (legacy src/backend/api/graphql/tenant.resolver.ts)
// - Intent: Resolve Tenant Branding Configuration for Client Hydration.
//   getTenantBranding(tenantSlug, customDomain) -> TenantBrandingConfig!
// - ObjectType name `TenantBrandingConfig` is distinct from Phase 030's
//   `TenantBranding` (navbar theme) — no schema collision.
// - Delegates to TenantResolverService (Redis-first, §10 self-heal).
// - Zero new deps.
import { Args, Field, ID, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { TenantResolverService } from '../../modules/tenant/tenant-resolver.service';

@ObjectType('TenantBrandingConfig')
class TenantBrandingConfigGql {
  @Field(() => ID) tenantId!: string;
  @Field() tenantSlug!: string;
  @Field() brandName!: string;
  @Field() logoUrl!: string;
  @Field() primaryColor!: string;
  @Field() secondaryColor!: string;
  @Field() accentColor!: string;
  @Field({ nullable: true }) customDomain?: string | null;
}

@Resolver('TenantEngine')
export class TenantResolver {
  constructor(private readonly tenants: TenantResolverService) {}

  @Query('getTenantBranding')
  async getTenantBranding(
    @Args('tenantSlug', { nullable: true }) tenantSlug?: string,
    @Args('customDomain', { nullable: true }) customDomain?: string,
  ) {
    const identifier = (tenantSlug ?? '').trim() || (customDomain ?? '').trim();
    if (!identifier) throw new BadRequestException('Missing tenantSlug or customDomain');
    const resolved = await this.tenants.resolveTenantIdentifier(
      (customDomain ?? '').trim() ? `custom:${(customDomain ?? '').trim().toLowerCase()}` : identifier,
    );
    const branding = await this.tenants.getBrandingConfig(resolved.tenantId);
    return {
      tenantId: branding.tenantId,
      tenantSlug: branding.tenantSlug,
      brandName: branding.brandName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      accentColor: branding.accentColor,
      customDomain: branding.customDomain ?? null,
    };
  }
}
