// SSOT Phase 077 §3.2/Gate 1 — Logistics GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/logistics/resolvers/logistics.resolver.ts
// - bookParcel / getShipmentTracking behind the authenticated gateway.
// - Zero new deps.
import { Args, Field, ID, InputType, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { LogisticsService } from '../services/logistics.service';
import type { LogisticsRepository } from '../domain/logistics.repository';
import { PrismaLogisticsRepository } from '../infrastructure/prisma-logistics.repository';

@ObjectType('BookParcelPayload')
class BookParcelPayloadGql {
  @Field(() => ID) shipmentId!: string;
  @Field() trackingNumber!: string;
  @Field({ nullable: true }) labelUrl?: string | null;
}

@ObjectType('TrackingHistoryRow')
class TrackingHistoryRowGql {
  @Field() statusCode!: string;
  @Field() statusText!: string;
  @Field({ nullable: true }) location?: string | null;
  @Field() eventTimestamp!: string;
}

@ObjectType('ShipmentTracking')
class ShipmentTrackingGql {
  @Field() orderNumber!: string;
  @Field() carrier!: string;
  @Field() trackingNumber!: string;
  @Field() status!: string;
  @Field(() => [TrackingHistoryRowGql]) history!: TrackingHistoryRowGql[];
}

@InputType('BookParcelInput')
class BookParcelInputGql {
  @Field(() => ID) orderId!: string;
  @Field() carrier!: string;
  @Field(() => Int) weightGrams!: number;
  @Field({ nullable: true }) remark?: string | null;
}

function gqlCtx(ctx: Record<string, unknown>): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing seller/tenant context');
  return { userId: user.id, tenantId };
}

@Resolver('Logistics')
export class LogisticsResolver {
  constructor(
    private readonly logistics: LogisticsService,
    private readonly repo: PrismaLogisticsRepository,
  ) {}

  @Query('getShipmentTracking')
  async getShipmentTracking(@Args('orderId') orderId: string, @Context() ctx: Record<string, unknown>) {
    if (!orderId) throw new BadRequestException('Missing orderId');
    const { tenantId } = gqlCtx(ctx);
    const repo: LogisticsRepository = this.repo;
    const detail = await repo.shipmentDetail(orderId, tenantId);
    if (!detail) throw new BadRequestException('Shipment not found');
    return {
      ...detail,
      history: detail.history.map((h) => ({ ...h, eventTimestamp: new Date(h.eventTimestamp).toISOString() })),
    };
  }

  @Mutation('bookParcel')
  bookParcel(@Args('input') input: BookParcelInputGql, @Context() ctx: Record<string, unknown>) {
    const { tenantId } = gqlCtx(ctx);
    return this.logistics.bookParcel(tenantId, { tenantId, ...input });
  }
}
