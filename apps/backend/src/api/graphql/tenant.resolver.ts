// SSOT Phase 071 §3.2 + Phase 072 §3.2 — Tenant GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/tenant.resolver.ts
// (legacy src/backend/api/graphql/tenant.resolver.ts)
// - 071: getTenantBranding(tenantSlug, customDomain) -> TenantBrandingConfig!
// - 072: getTenantTheme(tenantSlug!) -> CompanyThemeConfig! +
//   updateTenantTheme(input!) -> CompanyThemeConfig! (admin; guard at REST;
//   GQL resolves behind the authenticated gateway context).
// - ObjectType names are distinct from Phase 030's `TenantBranding` — no
//   schema collision. Zero new deps.
import { Args, Field, Float, ID, InputType, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { TenantResolverService } from '../../modules/tenant/tenant-resolver.service';
import { CompanyThemeService } from '../../modules/tenant/company-theme.service';

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

@ObjectType('CompanyLogoConfig')
class CompanyLogoConfigGql {
  @Field() primaryLogoUrl!: string;
  @Field({ nullable: true }) squareLogoUrl?: string | null;
  @Field({ nullable: true }) faviconUrl?: string | null;
  @Field({ nullable: true }) watermarkLogoUrl?: string | null;
  @Field(() => Int) widthPx!: number;
  @Field(() => Int) heightPx!: number;
}

@ObjectType('TypographyConfig')
class TypographyConfigGql {
  @Field() fontFamily!: string;
  @Field({ nullable: true }) fontUrl?: string | null;
  @Field(() => Int) baseFontSizePx!: number;
  @Field() headingWeight!: string;
}

@ObjectType('CompanyThemeConfig')
class CompanyThemeConfigGql {
  @Field(() => ID) tenantId!: string;
  @Field() companyName!: string;
  @Field() primaryColor!: string;
  @Field() secondaryColor!: string;
  @Field() accentColor!: string;
  @Field() backgroundColor!: string;
  @Field() textColor!: string;
  @Field(() => Float) borderRadiusRem!: number;
  @Field(() => CompanyLogoConfigGql) logoConfig!: CompanyLogoConfigGql;
  @Field(() => TypographyConfigGql) typography!: TypographyConfigGql;
  @Field() isAccessibilityCompliant!: boolean;
  @Field() updatedAt!: string;
}

@InputType('UpdateCompanyThemeInput')
class UpdateCompanyThemeInputGql {
  @Field(() => ID) tenantId!: string;
  @Field({ nullable: true }) primaryColor?: string | null;
  @Field({ nullable: true }) secondaryColor?: string | null;
  @Field({ nullable: true }) accentColor?: string | null;
  @Field({ nullable: true }) logoUrl?: string | null;
  @Field({ nullable: true }) fontFamily?: string | null;
  @Field({ nullable: true }) fontUrl?: string | null;
}

@Resolver('TenantEngine')
export class TenantResolver {
  constructor(
    private readonly tenants: TenantResolverService,
    private readonly companyThemes: CompanyThemeService,
  ) {}

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

  @Query('getTenantTheme')
  async getTenantTheme(@Args('tenantSlug') tenantSlug: string) {
    if (!(tenantSlug ?? '').trim()) throw new BadRequestException('Missing tenantSlug');
    const theme = await this.companyThemes.getThemeBySlug(tenantSlug);
    return toCompanyThemeGql(theme.tenantId, theme);
  }

  @Mutation('updateTenantTheme')
  async updateTenantTheme(@Args('input') input: UpdateCompanyThemeInputGql) {
    if (!input?.tenantId) throw new BadRequestException('Missing tenant id');
    const theme = await this.companyThemes.updateCompanyTheme({
      tenantId: input.tenantId,
      ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
      ...(input.secondaryColor ? { secondaryColor: input.secondaryColor } : {}),
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
      ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
      ...(input.fontFamily ? { fontFamily: input.fontFamily } : {}),
      ...(input.fontUrl ? { fontUrl: input.fontUrl } : {}),
    });
    return toCompanyThemeGql(theme.tenantId, theme);
  }
}

function toCompanyThemeGql(
  tenantId: string,
  theme: {
    companyName: string; primaryColor: string; secondaryColor: string; accentColor: string;
    backgroundColor: string; textColor: string; borderRadiusRem: number;
    logoConfig: { primaryLogoUrl: string; squareLogoUrl?: string; faviconUrl?: string; watermarkLogoUrl?: string; widthPx: number; heightPx: number };
    typography: { fontFamily: string; fontUrl?: string; baseFontSizePx: number; headingWeight: string };
    isAccessibilityCompliant: boolean; updatedAt: string;
  },
) {
  return {
    tenantId,
    companyName: theme.companyName,
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,
    accentColor: theme.accentColor,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    borderRadiusRem: theme.borderRadiusRem,
    logoConfig: { ...theme.logoConfig },
    typography: { ...theme.typography },
    isAccessibilityCompliant: theme.isAccessibilityCompliant,
    updatedAt: theme.updatedAt,
  };
}
