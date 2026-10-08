// SSOT Phase 075 §3.2/Gate 1 — Inventory GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/inventory/presentation/inventory.resolver.ts
// - getWarehouseInventory / getStockMovementLogs / updateBatchStock /
//   generateBatchThermalLabels behind the authenticated gateway.
// - Zero new deps.
import { Args, Field, ID, InputType, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { BatchStockUpdateUseCase } from '../application/batch-stock-update.usecase';
import { ThermalLabelService } from '../application/thermal-label.service';
import type { WarehouseInventoryRepository } from '../domain/warehouse-stock.repository';
import { PrismaInventoryRepository } from '../infrastructure/prisma-inventory.repository';

@ObjectType('WarehouseStockRow')
class WarehouseStockRowGql {
  @Field() sku!: string;
  @Field() title!: string;
  @Field(() => Int) stockQty!: number;
  @Field(() => Int) safetyStock!: number;
  @Field({ nullable: true }) rackLocation?: string | null;
}

@ObjectType('InventoryPagedResult')
class InventoryPagedResultGql {
  @Field(() => [WarehouseStockRowGql]) rows!: WarehouseStockRowGql[];
  @Field(() => Int) total!: number;
}

@ObjectType('StockMovementLogRow')
class StockMovementLogRowGql {
  @Field(() => ID) id!: string;
  @Field() sku!: string;
  @Field(() => ID) warehouseId!: string;
  @Field(() => Int) previousQty!: number;
  @Field(() => Int) newQty!: number;
  @Field(() => Int) quantityDelta!: number;
  @Field() adjustmentType!: string;
  @Field({ nullable: true }) remark?: string | null;
  @Field() createdAt!: string;
}

@ObjectType('FailedStockItem')
class FailedStockItemGql {
  @Field() sku!: string;
  @Field() reason!: string;
}

@ObjectType('BatchStockUpdateResult')
class BatchStockUpdateResultGql {
  @Field() success!: boolean;
  @Field(() => Int) totalUpdated!: number;
  @Field(() => [FailedStockItemGql]) failedItems!: FailedStockItemGql[];
  @Field() updatedAt!: string;
}

@ObjectType('ThermalLabelPayload')
class ThermalLabelPayloadGql {
  @Field() objectKey!: string;
  @Field() downloadUrl!: string;
  @Field(() => Int) count!: number;
}

@InputType('StockAdjustmentInput')
class StockAdjustmentInputGql {
  @Field() sku!: string;
  @Field(() => ID) warehouseId!: string;
  @Field(() => Int) quantityDelta!: number;
  @Field() adjustmentType!: string;
  @Field({ nullable: true }) remark?: string | null;
}

@InputType('BatchStockUpdateInput')
class BatchStockUpdateInputGql {
  @Field(() => [StockAdjustmentInputGql]) adjustments!: StockAdjustmentInputGql[];
}

@InputType('ThermalLabelPrintInput')
class ThermalLabelPrintInputGql {
  @Field(() => [ID]) orderIds!: string[];
  @Field() labelFormat!: string;
  @Field(() => Boolean, { nullable: true }) includePackingList?: boolean | null;
}

function gqlCtx(ctx: Record<string, unknown>): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing seller/tenant context');
  return { userId: user.id, tenantId };
}

@Resolver('Inventory')
export class InventoryResolver {
  constructor(
    private readonly batch: BatchStockUpdateUseCase,
    private readonly labels: ThermalLabelService,
    private readonly repo: PrismaInventoryRepository,
  ) {}

  @Query('getWarehouseInventory')
  async getWarehouseInventory(
    @Args('warehouseId', { nullable: true }) warehouseId: string | undefined,
    @Args('searchSKU', { nullable: true }) searchSKU: string | undefined,
    @Args('page', { nullable: true }) page: number | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
  ) {
    if (!warehouseId) throw new BadRequestException('Missing warehouseId');
    const take = Math.min(100, Math.max(1, limit ?? 20));
    const repo: WarehouseInventoryRepository = this.repo;
    const { rows, total } = await repo.listWarehouseStock(warehouseId, searchSKU ?? '', ((page ?? 1) - 1) * take, take);
    return { rows, total };
  }

  @Query('getStockMovementLogs')
  getStockMovementLogs(@Args('sku') sku: string, @Args('limit', { nullable: true }) limit: number | undefined) {
    if (!sku) throw new BadRequestException('Missing sku');
    const repo: WarehouseInventoryRepository = this.repo;
    return repo.movementLogs(sku, Math.min(100, Math.max(1, limit ?? 20))).then((rows) =>
      rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })),
    );
  }

  @Mutation('updateBatchStock')
  updateBatchStock(@Args('input') input: BatchStockUpdateInputGql, @Context() ctx: Record<string, unknown>) {
    const { userId, tenantId } = gqlCtx(ctx);
    return this.batch.execute(tenantId, { tenantId, updatedByUserId: userId, adjustments: input.adjustments });
  }

  @Mutation('generateBatchThermalLabels')
  generateBatchThermalLabels(@Args('input') input: ThermalLabelPrintInputGql, @Context() ctx: Record<string, unknown>) {
    const { tenantId } = gqlCtx(ctx);
    return this.labels.generateBatch(tenantId, {
      orderIds: input.orderIds,
      labelFormat: input.labelFormat,
      includePackingList: input.includePackingList ?? true,
    });
  }
}
