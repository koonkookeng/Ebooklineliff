// SSOT Phase 075 §5 — Inventory REST (batch + ledger + labels)
// Canonical: apps/backend/src/modules/inventory/presentation/inventory.controller.ts
// - POST stock/batch — JWT + TenantGuard + merchant role (BDD-2, ≤1000).
// - GET stock?warehouseId=&q=&page= — tenant-isolated ledger rows.
// - GET movements?sku= — immutable audit trail.
// - POST labels/batch — tenant-vaulted PDF/ZPL/TSPL (Gate 6).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ThermalLabelPrintRequestSchema } from '@repo/shared';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../merchant/domain/entities/merchant-account.entity';
import { BatchStockUpdateUseCase } from '../application/batch-stock-update.usecase';
import { ThermalLabelService } from '../application/thermal-label.service';
import type { WarehouseInventoryRepository } from '../domain/warehouse-stock.repository';
import { PrismaInventoryRepository } from '../infrastructure/prisma-inventory.repository';

function tenantOf(req: Record<string, unknown>): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

@Controller('api/v1/inventory')
@UseGuards(JwtAuthGuard, TenantGuard)
export class InventoryController {
  constructor(
    private readonly batch: BatchStockUpdateUseCase,
    private readonly labels: ThermalLabelService,
    private readonly repo: PrismaInventoryRepository,
  ) {}

  @Post('stock/batch')
  updateBatch(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    const userId = (req['user'] as { id?: string } | undefined)?.id ?? '';
    return this.batch.execute(tenantOf(req), { ...((body ?? {}) as Record<string, unknown>), updatedByUserId: userId });
  }

  @Get('stock')
  async stock(
    @Req() req: Record<string, unknown>,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    if (!warehouseId) throw new BadRequestException('Missing warehouseId');
    const take = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = Math.max(0, ((Number(page) || 1) - 1) * take);
    const repo: WarehouseInventoryRepository = this.repo;
    const { rows, total } = await repo.listWarehouseStock(warehouseId, q ?? '', skip, take);
    return { tenantId: tenantOf(req), rows, total, page: Number(page) || 1, limit: take };
  }

  @Get('movements')
  movements(@Query('sku') sku: string | undefined, @Query('limit') limit: string | undefined) {
    if (!sku) throw new BadRequestException('Missing sku');
    const repo: WarehouseInventoryRepository = this.repo;
    return repo.movementLogs(sku, Math.min(100, Math.max(1, Number(limit) || 20)));
  }

  @Post('labels/batch')
  labelsBatch(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole((req['user'] as { role?: string } | undefined)?.role);
    const parsed = ThermalLabelPrintRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid label request');
    return this.labels.generateBatch(tenantOf(req), parsed.data);
  }
}
