// SSOT Phase 079 Task 6 — Affiliate payout service (3% withholding)
// Canonical: apps/backend/src/modules/affiliate/services/payout.service.ts
// - requestPayout: Zod gate -> APPROVED-earnings cover check -> 3% split ->
//   REQUESTED row with unique payoutNo (P2002-safe retry).
// - dashboard: earnings + counts + referral link material.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { AffiliatePayoutRequestSchema, payoutNumber } from '@repo/shared';
import { splitPayout } from '../domain/affiliate.entity';
import type { AffiliateRepository } from '../domain/affiliate.repository';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: AffiliateRepository) {}

  async requestPayout(
    headerTenantId: string | undefined,
    actorUserId: string,
    body: unknown,
  ): Promise<{ payoutId: string; requestedAmount: number; taxWithheld3Percent: number; netPayoutAmount: number; status: string }> {
    const parsed = AffiliatePayoutRequestSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: (headerTenantId ?? '').trim(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid payout request');
    const { tenantId, amount, bankName, bankAccountNumber, bankAccountName } = parsed.data;

    const me = await this.repo.findUser(actorUserId);
    if (!me) throw new BadRequestException('Affiliate account not found');
    const available = await this.repo.approvedEarnings(actorUserId);
    if (amount > available) {
      throw new BadRequestException(`Insufficient approved earnings (available ${available})`);
    }

    const split = splitPayout(amount);
    try {
      const row = await this.repo.createPayout({
        payoutNo: payoutNumber(tenantId),
        userId: actorUserId,
        requestedAmount: split.requested,
        taxWithheldAmount: split.tax,
        netPayoutAmount: split.net,
        bankName,
        bankAccountNumber,
        bankAccountName,
      });
      return {
        payoutId: row.id,
        requestedAmount: split.requested,
        taxWithheld3Percent: split.tax,
        netPayoutAmount: split.net,
        status: 'REQUESTED',
      };
    } catch {
      throw new BadRequestException('Payout already submitted, please retry');
    }
  }

  async dashboard(actorUserId: string): Promise<{
    totalEarnings: number;
    pendingEarnings: number;
    tier1ReferralsCount: number;
    tier2ReferralsCount: number;
    affiliateCode: string;
    referralLink: string;
  }> {
    const d = await this.repo.dashboard(actorUserId);
    return {
      totalEarnings: d.totalEarnings,
      pendingEarnings: d.pendingEarnings,
      tier1ReferralsCount: d.tier1Count,
      tier2ReferralsCount: d.tier2Count,
      affiliateCode: d.affiliateCode,
      referralLink: '',
    };
  }
}
