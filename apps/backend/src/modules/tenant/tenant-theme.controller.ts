// SSOT Phase 030 Task 5 — Tenant theme REST controller (provider fetch path)
// Canonical: apps/backend/src/modules/tenant/tenant-theme.controller.ts
// (legacy src/backend/modules/tenant/tenant-theme.controller.ts)
// - GET  /api/v1/tenant/theme?slug= — PUBLIC (storefront branding for logged-out
//   LIFF opens; payload carries no PII, only colors + logo URL).
// - PUT  /api/v1/tenant/theme — JWT-guarded admin update (Zod-gated in service).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { TenantThemeService } from './tenant-theme.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

@Controller('api/v1/tenant')
export class TenantThemeController {
  constructor(private readonly themes: TenantThemeService) {}

  @Get('theme')
  theme(@Query('slug') slug: string | undefined) {
    if (!slug) throw new BadRequestException('Missing tenant slug');
    return this.themes.getTenantBranding(slug);
  }

  @Put('theme')
  @UseGuards(JwtAuthGuard)
  update(@Body() body: unknown) {
    return this.themes.updateNavbarTheme(body);
  }
}
