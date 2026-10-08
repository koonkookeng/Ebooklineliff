// SSOT Phase 076 §5 — Fulfillment queue REST (batch booking + ledger)
// Canonical: apps/backend/src/modules/fulfillment/controllers/fulfillment-queue.controller.ts
// - POST queue/batch — JWT + TenantGuard + merchant role (BDD-1, ≤500).
// - POST queue/:batchId/drain — run the booking pipeline for queued items.
// - GET queue?status=&page= — tenant-isolated ledger rows.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../merchant/domain/entities/merchant-account.entity';
import { FulfillmentQueueService } from '../services/fulfillment-queue.service';
import { FulfillmentQueueProcessor } from '../processors/fulfillment-queue.processor';
import type { FulfillmentRepository } from '../domain/fulfillment.repository';
import { PrismaFulfillmentRepository } from '../infrastructure/prisma-fulfillment.repository';

function tenantOf(req: Record<string, unknown>): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

@Controller('api/v1/fulfillment')
@UseGuards(JwtAuthGuard, TenantGuard)
export class FulfillmentQueueController {
  constructor(
    private readonly queue: FulfillmentQueueService,
    private readonly processor: FulfillmentQueueProcessor,
    private readonly repo: PrismaFulfillmentRepository,
  ) {}

  @Post('queue/batch')
  queueBatch(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    return this.queue.queueBatchBooking(tenantOf(req), body);
  }

  @Post('queue/:batchId/drain')
  async drain(
    @Req() req: Record<string, unknown>,
    @Param('batchId') batchId: string,
    @Body() body: { orderIds?: string[]; warehouseId?: string; courierProvider?: string },
  ) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    const tenantId = tenantOf(req);
    const orderIds = Array.isArray(body?.orderIds) ? body.orderIds : [];
    if (orderIds.length === 0) throw new BadRequestException('Missing orderIds');
    if (orderIds.length > 500) throw new BadRequestException('Max 500 orders per drain');
    const jobs = orderIds.map((orderId) => ({
      orderId,
      courierProvider: body?.courierProvider ?? 'FLASH_EXPRESS',
      tenantId,
      batchId,
      warehouseId: body?.warehouseId ?? '',
    }));
    return this.processor.drain(batchId, tenantId, jobs);
  }

  @Get('queue')
  async ledger(
    @Req() req: Record<string, unknown>,
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const take = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = Math.max(0, ((Number(page) || 1) - 1) * take);
    const repo: FulfillmentRepository = this.repo;
    const { rows, total } = await repo.listQueue(tenantOf(req), status ?? null, skip, take);
    return { rows, total, page: Number(page) || 1, limit: take };
  }
}
