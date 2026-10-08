// SSOT Phase 076 §3.2/Gate 1 — Fulfillment GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/fulfillment/resolvers/fulfillment.resolver.ts
// - getFulfillmentQueue / queueBatchBooking / drainFulfillmentBatch /
//   printBatchLabels behind the authenticated gateway.
// - Zero new deps.
import { Args, Field, ID, InputType, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { FulfillmentQueueService } from '../services/fulfillment-queue.service';
import { FulfillmentQueueProcessor } from '../processors/fulfillment-queue.processor';
import { BatchThermalPrintService } from '../services/batch-thermal-print.service';
import type { FulfillmentRepository } from '../domain/fulfillment.repository';
import { PrismaFulfillmentRepository } from '../infrastructure/prisma-fulfillment.repository';

@ObjectType('FulfillmentQueueRow')
class FulfillmentQueueRowGql {
  @Field(() => ID) orderId!: string;
  @Field() orderNumber!: string;
  @Field() courierProvider!: string;
  @Field({ nullable: true }) trackingNumber?: string | null;
  @Field() status!: string;
  @Field() updatedAt!: string;
}

@ObjectType('FulfillmentQueuePage')
class FulfillmentQueuePageGql {
  @Field(() => [FulfillmentQueueRowGql]) rows!: FulfillmentQueueRowGql[];
  @Field(() => Int) total!: number;
}

@ObjectType('FailedFulfillmentItem')
class FailedFulfillmentItemGql {
  @Field() orderId!: string;
  @Field() reason!: string;
}

@ObjectType('BatchBookingResult')
class BatchBookingResultGql {
  @Field(() => ID) batchId!: string;
  @Field() batchNumber!: string;
  @Field(() => Int) queued!: number;
  @Field(() => [FailedFulfillmentItemGql]) failed!: FailedFulfillmentItemGql[];
}

@ObjectType('DrainBatchResult')
class DrainBatchResultGql {
  @Field(() => Int) booked!: number;
  @Field(() => [FailedFulfillmentItemGql]) failed!: FailedFulfillmentItemGql[];
}

@ObjectType('BatchPrintPayload')
class BatchPrintPayloadGql {
  @Field() success!: boolean;
  @Field(() => Int) totalProcessed!: number;
  @Field(() => [FailedFulfillmentItemGql]) failedOrders!: FailedFulfillmentItemGql[];
  @Field() objectKey!: string;
  @Field() downloadUrl!: string;
}

@InputType('BatchBookingInput')
class BatchBookingInputGql {
  @Field(() => [ID]) orderIds!: string[];
  @Field() courierProvider!: string;
  @Field(() => ID) warehouseId!: string;
}

@InputType('BatchPrintInput')
class BatchPrintInputGql {
  @Field(() => [ID]) orderIds!: string[];
  @Field() courierProvider!: string;
  @Field({ nullable: true }) labelDpi?: string | null;
  @Field(() => Boolean, { nullable: true }) autoUpdateStatusToPrinted?: boolean | null;
}

function gqlCtx(ctx: Record<string, unknown>): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing seller/tenant context');
  return { userId: user.id, tenantId };
}

@Resolver('Fulfillment')
export class FulfillmentResolver {
  constructor(
    private readonly queue: FulfillmentQueueService,
    private readonly processor: FulfillmentQueueProcessor,
    private readonly print: BatchThermalPrintService,
    private readonly repo: PrismaFulfillmentRepository,
  ) {}

  @Query('getFulfillmentQueue')
  async getFulfillmentQueue(
    @Args('status', { nullable: true }) status: string | undefined,
    @Args('page', { nullable: true }) page: number | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Context() ctx: Record<string, unknown>,
  ) {
    const { tenantId } = gqlCtx(ctx);
    const take = Math.min(100, Math.max(1, limit ?? 20));
    const repo: FulfillmentRepository = this.repo;
    const { rows, total } = await repo.listQueue(tenantId, status ?? null, ((page ?? 1) - 1) * take, take);
    return {
      rows: rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() })),
      total,
    };
  }

  @Mutation('queueBatchBooking')
  queueBatchBooking(@Args('input') input: BatchBookingInputGql, @Context() ctx: Record<string, unknown>) {
    const { tenantId } = gqlCtx(ctx);
    return this.queue.queueBatchBooking(tenantId, { tenantId, ...input });
  }

  @Mutation('drainFulfillmentBatch')
  drainFulfillmentBatch(
    @Args('batchId') batchId: string,
    @Args('input') input: BatchBookingInputGql,
    @Context() ctx: Record<string, unknown>,
  ) {
    const { tenantId } = gqlCtx(ctx);
    return this.processor.drain(
      batchId,
      tenantId,
      input.orderIds.map((orderId) => ({
        orderId,
        courierProvider: input.courierProvider,
        tenantId,
        batchId,
        warehouseId: input.warehouseId,
      })),
    );
  }

  @Mutation('printBatchLabels')
  printBatchLabels(@Args('input') input: BatchPrintInputGql, @Context() ctx: Record<string, unknown>) {
    const { tenantId } = gqlCtx(ctx);
    return this.print.printBatch(tenantId, {
      orderIds: input.orderIds,
      courierProvider: input.courierProvider,
      labelDpi: input.labelDpi ?? 'DPI_203',
      autoUpdateStatusToPrinted: input.autoUpdateStatusToPrinted ?? true,
    });
  }
}
