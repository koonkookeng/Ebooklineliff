// SSOT Phase 077 §5 — Logistics REST (parcel booking + tracking)
// Canonical: apps/backend/src/modules/logistics/controllers/logistics.controller.ts
// - POST parcels/book — JWT + TenantGuard + merchant role (BDD-1, <800ms).
// - GET shipments/:orderId — tenant-isolated tracking + history (LIFF view).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../merchant/domain/entities/merchant-account.entity';
import { LogisticsService } from '../services/logistics.service';
import type { LogisticsRepository } from '../domain/logistics.repository';
import { PrismaLogisticsRepository } from '../infrastructure/prisma-logistics.repository';

function tenantOf(req: Record<string, unknown>): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

@Controller('api/v1/logistics')
@UseGuards(JwtAuthGuard, TenantGuard)
export class LogisticsController {
  constructor(
    private readonly logistics: LogisticsService,
    private readonly repo: PrismaLogisticsRepository,
  ) {}

  @Post('parcels/book')
  bookParcel(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    return this.logistics.bookParcel(tenantOf(req), body);
  }

  @Get('shipments/:orderId')
  async tracking(@Req() req: Record<string, unknown>, @Param('orderId') orderId: string) {
    if (!orderId) throw new BadRequestException('Missing orderId');
    const repo: LogisticsRepository = this.repo;
    const detail = await repo.shipmentDetail(orderId, tenantOf(req));
    if (!detail) throw new BadRequestException('Shipment not found');
    return detail;
  }
}
