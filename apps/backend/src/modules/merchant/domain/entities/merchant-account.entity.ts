// SSOT Phase 073 §5.1 — Merchant account entity (ownership invariants)
// Canonical: apps/backend/src/modules/merchant/domain/entities/merchant-account.entity.ts
// - Guards: a product write must carry the guarded tenantId (BDD-1 isolation);
//   payout minimum 1000 THB (PayoutRequestSchema); fulfillment transition
//   follows UNFULFILLED -> PACKED -> SHIPPED -> DELIVERED (RETURNED terminal).
// - Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PAYOUT_MIN_AMOUNT } from '@repo/shared';

const FULFILLMENT_FLOW = ['UNFULFILLED', 'PACKED', 'SHIPPED', 'DELIVERED'] as const;

export function assertTenantOwnership(headerTenantId: string | undefined, bodyTenantId: string | undefined): string {
  const header = (headerTenantId ?? '').trim();
  if (!header) throw new ForbiddenException('Missing X-Tenant-ID header context.');
  if (bodyTenantId && bodyTenantId.trim() && bodyTenantId.trim() !== header) {
    throw new ForbiddenException('Cross-tenant write blocked.');
  }
  return header;
}

export function assertMerchantRole(role: string | undefined): void {
  if (role !== 'INSTRUCTOR' && role !== 'SELLER' && role !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Unauthorized merchant access or missing tenant header');
  }
}

export function assertPayoutMinimum(amount: number): void {
  if (!(amount >= PAYOUT_MIN_AMOUNT)) {
    throw new BadRequestException('ขั้นต่ำการถอนเงินคือ 1,000 บาท');
  }
}

/** Forward-only fulfillment transitions (RETURNED is terminal/any-state). */
export function assertFulfillmentTransition(from: string, to: string): void {
  if (to === 'RETURNED') return;
  const fromIdx = FULFILLMENT_FLOW.indexOf(from as (typeof FULFILLMENT_FLOW)[number]);
  const toIdx = FULFILLMENT_FLOW.indexOf(to as (typeof FULFILLMENT_FLOW)[number]);
  if (fromIdx === -1 || toIdx === -1 || toIdx !== fromIdx + 1) {
    throw new BadRequestException(`Illegal fulfillment transition ${from} -> ${to}`);
  }
}
