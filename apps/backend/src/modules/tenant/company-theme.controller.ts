// SSOT Phase 072 §5/§6 — Public company-theme REST (LIFF first-ms hydration)
// Canonical: apps/backend/src/modules/tenant/company-theme.controller.ts
// - GET /api/v1/tenant/company-theme?slug= — PUBLIC (no PII, colors + logo).
// - PUT /api/v1/tenant/company-theme — JWT-guarded admin update.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CompanyThemeService } from './company-theme.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

@Controller('api/v1/tenant')
export class CompanyThemeController {
  constructor(private readonly themes: CompanyThemeService) {}

  @Get('company-theme')
  companyTheme(@Query('slug') slug: string | undefined) {
    if (!slug) throw new BadRequestException('Missing tenant slug');
    return this.themes.getThemeBySlug(slug);
  }

  @Put('company-theme')
  @UseGuards(JwtAuthGuard)
  update(@Body() body: unknown) {
    return this.themes.updateCompanyTheme(body);
  }
}
