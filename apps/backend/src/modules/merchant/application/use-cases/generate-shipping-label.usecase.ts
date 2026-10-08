// SSOT Phase 073 Task 2 — Shipping label use-case (forward-only fulfillment)
// Canonical: apps/backend/src/modules/merchant/application/use-cases/generate-shipping-label.usecase.ts
// - Guards: order must belong to the header tenant (cross-tenant fulfill
//   blocked, BDD-1); forward-only status flow; tracking required to SHIP.
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  assertFulfillmentTransition,
  assertTenantOwnership,
} from '../../domain/entities/merchant-account.entity';
import type { MerchantRepository } from '../../infrastructure/repositories/prisma-merchant.repository';

const ShippingLabelSchema = z.object({
  orderId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  status: z.enum(['PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED']),
  courierName: z.string().min(1).optional(),
  trackingNumber: z.string().min(1).optional(),
  fromStatus: z.enum(['UNFULFILLED', 'PACKED', 'SHIPPED', 'DELIVERED']).default('UNFULFILLED'),
});

@Injectable()
export class GenerateShippingLabelUseCase {
  constructor(private readonly repo: MerchantRepository) {}

  async execute(headerTenantId: string | undefined, body: unknown) {
    const tenantId = assertTenantOwnership(headerTenantId, undefined);
    const parsed = ShippingLabelSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid fulfillment payload');
    const orderTenant = await this.repo.findOrderTenant(parsed.data.orderId);
    if (!orderTenant || orderTenant !== tenantId) {
      throw new ForbiddenException('Cross-tenant fulfillment blocked.');
    }
    assertFulfillmentTransition(parsed.data.fromStatus, parsed.data.status);
    if (parsed.data.status === 'SHIPPED' && !parsed.data.trackingNumber) {
      throw new BadRequestException('Tracking number required to ship.');
    }
    const row = await this.repo.upsertFulfillment({
      orderId: parsed.data.orderId,
      warehouseId: parsed.data.warehouseId,
      status: parsed.data.status,
      ...(parsed.data.courierName ? { courierName: parsed.data.courierName } : {}),
      ...(parsed.data.trackingNumber ? { trackingNumber: parsed.data.trackingNumber } : {}),
    });
    return { fulfillmentId: row.id, status: row.status, trackingNumber: parsed.data.trackingNumber ?? null };
  }
}
