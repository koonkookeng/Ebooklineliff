// SSOT Phase 081 Task 4 — Multi-tier commission calculator (rule-driven split)
// Canonical: apps/backend/src/modules/commission/application/commission-calculator.service.ts
// - Reads the CommissionRule card (per-product else global else 5/10/2) and
//   returns the cents-exact split. Persistence stays in the finance posting
//   engine (single writer, zero-redundant policy — this service never posts).
// - The 079 affiliate engine keeps its own AffiliateTierConfig cards; this
//   calculator serves the double-entry settlement path (BDD-1).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { CommissionSplitSchema, FINANCE_TIER1_DEFAULT, FINANCE_TIER2_DEFAULT, FINANCE_PLATFORM_FEE_DEFAULT, splitRevenue } from '@repo/shared';

export interface CommissionRulePort {
  commissionRule(productId: string | null): Promise<{
    platformFeePercent: number;
    tier1Percent: number;
    tier2Percent: number;
  }>;
}

@Injectable()
export class CommissionCalculatorService {
  constructor(private readonly rules: CommissionRulePort) {}

  async calculate(args: {
    orderId: string;
    grossAmount: number;
    productId?: string | null;
    hasTier1?: boolean;
    hasTier2?: boolean;
  }): Promise<{
    orderId: string;
    grossAmount: number;
    platformFeeAmount: number;
    sellerNetAmount: number;
    affiliateTier1Amount: number;
    affiliateTier2Amount: number;
  }> {
    let rule = { platformFeePercent: FINANCE_PLATFORM_FEE_DEFAULT, tier1Percent: FINANCE_TIER1_DEFAULT, tier2Percent: FINANCE_TIER2_DEFAULT };
    try {
      rule = await this.rules.commissionRule(args.productId ?? null);
    } catch {
      // Rule store unreachable → spec defaults (fail-open on rates only;
      // the posting engine still enforces the balance equation).
    }
    const split = splitRevenue(args.grossAmount, {
      platformFeePercent: rule.platformFeePercent,
      tier1Percent: args.hasTier1 === false ? 0 : rule.tier1Percent,
      tier2Percent: args.hasTier2 === false ? 0 : rule.tier2Percent,
    });
    const parsed = CommissionSplitSchema.safeParse({
      orderId: args.orderId,
      grossAmount: args.grossAmount,
      platformFeeAmount: split.platformFeeAmount,
      sellerNetAmount: split.sellerNetAmount,
      affiliateTier1Amount: split.affiliateTier1Amount,
      affiliateTier2Amount: split.affiliateTier2Amount,
    });
    if (!parsed.success) throw new Error('Invalid commission split');
    return {
      orderId: args.orderId,
      grossAmount: args.grossAmount,
      platformFeeAmount: split.platformFeeAmount,
      sellerNetAmount: split.sellerNetAmount,
      affiliateTier1Amount: split.affiliateTier1Amount,
      affiliateTier2Amount: split.affiliateTier2Amount,
    };
  }
}
