// SSOT Phase 073 BDD-1/BDD-3 — Merchant payout + fulfillment + analytics REST
// Canonical: apps/backend/src/modules/merchant/infrastructure/controllers/merchant-payout.controller.ts
// - POST payout/request — JWT + TenantGuard + merchant role, atomic 3% tax.
// - POST fulfillment/label — forward-only, cross-tenant blocked.
// - GET analytics?from=&to= — tenant-isolated daily rows (BDD-1; 403 on
//   cross-tenant is enforced by TenantGuard + header-bound tenantId).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MerchantAnalyticsFilterSchema } from '@repo/shared';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../domain/entities/merchant-account.entity';
import { ProcessPayoutRequestUseCase } from '../../application/use-cases/process-payout-request.usecase';
import { GenerateShippingLabelUseCase } from '../../application/use-cases/generate-shipping-label.usecase';
import type { MerchantRepository } from '../repositories/prisma-merchant.repository';
import { PrismaMerchantRepository } from '../repositories/prisma-merchant.repository';

function headerTenant(req: Record<string, unknown>): string | undefined {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'];
}

@Controller('api/v1/merchant')
@UseGuards(JwtAuthGuard, TenantGuard)
export class MerchantPayoutController {
  constructor(
    private readonly payouts: ProcessPayoutRequestUseCase,
    private readonly labels: GenerateShippingLabelUseCase,
    private readonly repo: PrismaMerchantRepository,
  ) {}

  @Post('payout/request')
  payout(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    return this.payouts.execute(headerTenant(req), body);
  }

  @Post('fulfillment/label')
  label(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    return this.labels.execute(headerTenant(req), body);
  }

  @Get('analytics')
  async analytics(
    @Req() req: Record<string, unknown>,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    const tenantId = headerTenant(req) ?? '';
    const parsed = MerchantAnalyticsFilterSchema.safeParse({
      tenantId,
      startDate: from ?? new Date(0).toISOString(),
      endDate: to ?? new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid analytics filter');
    const repo: MerchantRepository = this.repo;
    const rows = await repo.analyticsRange(tenantId, new Date(parsed.data.startDate), new Date(parsed.data.endDate));
    return {
      tenantId,
      rows: rows.map((r) => ({
        recordDate: r.recordDate,
        totalGmv: String(r.totalGmv),
        totalOrders: r.totalOrders,
        ebookSalesCount: r.ebookSalesCount,
        courseSalesCount: r.courseSalesCount,
        physicalSalesCount: r.physicalSalesCount,
        newStudentsCount: r.newStudentsCount,
      })),
    };
  }
}
