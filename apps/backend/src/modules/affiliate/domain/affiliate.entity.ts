// SSOT Phase 079 §5 — Affiliate domain entity (fraud + money guards)
// Canonical: apps/backend/src/modules/affiliate/domain/affiliate.entity.ts
// - Guards: tenant isolation, self-referral (buyer == beneficiary),
//   circular chain (§10), payout floor 100 THB, 3% split sanity.
// - Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PAYOUT_MIN_THB, isAcyclicChain, payoutSplit } from '@repo/shared';

export function assertAffiliateTenant(headerTenantId: string | undefined, rowTenantId: string | null | undefined): void {
  const header = (headerTenantId ?? '').trim();
  if (!header) throw new ForbiddenException('Missing X-Tenant-ID header context.');
  if (rowTenantId && rowTenantId !== header) {
    throw new ForbiddenException('Cross-tenant affiliate access blocked.');
  }
}

/** Buyer must differ from every beneficiary (BDD-3 self-referral). */
export function assertNoSelfReferral(buyerId: string, beneficiaryIds: Array<string | null>): void {
  if (beneficiaryIds.some((id) => id && id === buyerId)) {
    throw new BadRequestException('SELF_REFERRAL_BLOCKED');
  }
}

export function assertAcyclic(buyerId: string, ancestors: Array<{ id: string } | null>): void {
  if (!isAcyclicChain(buyerId, ancestors)) {
    throw new BadRequestException('Circular referral chain blocked');
  }
}

export function assertPayoutFloor(amount: number): void {
  if (!(amount >= PAYOUT_MIN_THB)) {
    throw new BadRequestException('Minimum payout is 100 THB');
  }
}

export function splitPayout(amount: number): { requested: number; tax: number; net: number } {
  assertPayoutFloor(amount);
  return payoutSplit(amount);
}

/** Short referral code from a uuid (8 upper-alnum chars). */
export function shortAffiliateCode(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 8).toUpperCase();
}
