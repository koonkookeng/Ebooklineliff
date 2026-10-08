// SSOT Phase 076 BDD-2 — Batch thermal print REST (TSPL/PDF -> R2)
// Canonical: apps/backend/src/modules/fulfillment/controllers/thermal-print.controller.ts
// - POST print/batch — JWT + TenantGuard + merchant role (≤500, booked-only).
// - Returns R2 presigned URL (24h) + raw TSPL for Web Serial streaming.
// - Zero new deps.
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../merchant/domain/entities/merchant-account.entity';
import { BatchThermalPrintService } from '../services/batch-thermal-print.service';

function tenantOf(req: Record<string, unknown>): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

@Controller('api/v1/fulfillment')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ThermalPrintController {
  constructor(private readonly print: BatchThermalPrintService) {}

  @Post('print/batch')
  printBatch(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    return this.print.printBatch(tenantOf(req), body);
  }
}
