// SSOT Phase 030 Task 2/§3.2 — Tenant theme GraphQL presentation (code-first)
// Canonical: apps/backend/src/modules/tenant/tenant-theme.resolver.ts
// (legacy src/backend/modules/tenant/tenant-theme.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/tenant-theme.graphql/schema.graphql.
// - Zero new deps.
import { Resolver, Query, Mutation, Args, ObjectType, Field, ID, InputType } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { TenantThemeService } from './tenant-theme.service';

@ObjectType('TenantBranding')
class TenantBrandingGql {
  @Field(() => ID) tenantId!: string;
  @Field() brandName!: string;
  @Field({ nullable: true }) logoUrl!: string | null;
  @Field() primaryColor!: string;
  @Field() navBarBgColor!: string;
  @Field() navBarTextColor!: string;
  @Field() iconTheme!: string;
  @Field() enableCustomCloseButton!: boolean;
  @Field() enableShareOptionMenu!: boolean;
  @Field({ nullable: true }) updatedAt!: string | null;
}

@InputType('UpdateNavbarThemeInput')
class UpdateNavbarThemeInputGql {
  @Field(() => ID) tenantId!: string;
  @Field() primaryColor!: string;
  @Field() navBarBgColor!: string;
  @Field() navBarTextColor!: string;
  @Field({ nullable: true }) iconTheme!: string | null;
  @Field({ nullable: true }) enableCustomCloseButton!: boolean | null;
  @Field({ nullable: true }) enableShareOptionMenu!: boolean | null;
}

@Resolver('TenantTheme')
export class TenantThemeResolver {
  constructor(private readonly themes: TenantThemeService) {}

  @Query('tenantBranding')
  tenantBranding(@Args('slug') slug: string) {
    if (!slug) throw new BadRequestException('Missing tenant slug');
    return this.themes.getTenantBranding(slug);
  }

  @Mutation('updateNavbarTheme')
  updateNavbarTheme(@Args('input') input: UpdateNavbarThemeInputGql) {
    if (!input?.tenantId) throw new BadRequestException('Missing tenant id');
    return this.themes.updateNavbarTheme({
      tenantId: input.tenantId,
      primaryColor: input.primaryColor,
      navBarBgColor: input.navBarBgColor,
      navBarTextColor: input.navBarTextColor,
      ...(input.iconTheme ? { iconTheme: input.iconTheme } : {}),
      ...(typeof input.enableCustomCloseButton === 'boolean' ? { enableCustomCloseButton: input.enableCustomCloseButton } : {}),
      ...(typeof input.enableShareOptionMenu === 'boolean' ? { enableShareOptionMenu: input.enableShareOptionMenu } : {}),
    });
  }
}
