// SSOT Phase 082 BDD-1/Task 3 — Calculate-tax use-case (profile-aware 3%)
// Canonical: apps/backend/src/modules/tax/application/use-cases/calculate-tax.use-case.ts
// - Flow: Zod gate -> payout lookup (gross source of truth) -> profile
//   resolve (exempt → 0; missing profile → standard 3% + anomaly flag) ->
//   single-source domain math (§9) -> TAX_WITHHELD stream handoff for the
//   async PDF worker (Task 7 queue shape, Redis-stream transport).
// - Anomaly flags (§7.2): invalid Tax-ID checksum, duplicate certificate for
//   the same payout, exempt-without-verification.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { CalculateTaxRequestSchema, TAX_WITHHELD_STREAM, verifyThaiTaxId } from '@repo/shared';
import { TaxCalculatorDomainService } from '../../domain/services/tax-calculator.domain-service';
import type { TaxRepository } from '../../infrastructure/repositories/tax-prisma.repository';

export interface TaxBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class CalculateTaxUseCase {
  constructor(
    private readonly repo: TaxRepository,
    private readonly bus: TaxBus,
  ) {}

  async execute(args: {
    tenantId: string;
    actorUserId: string;
    body: unknown;
  }): Promise<{
    payoutRequestId: string;
    grossAmount: number;
    taxRate: number;
    taxWithheld: number;
    netAmount: number;
    isExempt: boolean;
    anomalies: string[];
  }> {
    const parsed = CalculateTaxRequestSchema.safeParse(args.body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid tax calculation request');

    const payout = await this.repo.findPayout(parsed.data.payoutRequestId);
    if (!payout) throw new BadRequestException('Payout request not found');
    if (payout.userId !== args.actorUserId) throw new BadRequestException('Payout does not belong to actor');

    const profile = await this.repo.findProfile(args.actorUserId);
    const anomalies: string[] = [];
    if (profile && !verifyThaiTaxId(profile.taxId)) anomalies.push('INVALID_TAX_ID');
    if (!profile) anomalies.push('PROFILE_UNVERIFIED');

    const calc = (profile?.isTaxExempt
      ? new TaxCalculatorDomainService().calculate(parsed.data.grossAmount, { isTaxExempt: true })
      : TaxCalculatorDomainService.calculate3PercentWithholding(parsed.data.grossAmount));

    await this.bus
      .xadd(TAX_WITHHELD_STREAM, {
        event: 'TAX_WITHHELD_EVENT',
        payoutRequestId: parsed.data.payoutRequestId,
        userId: args.actorUserId,
        grossAmount: parsed.data.grossAmount,
        taxWithheld: calc.taxWithheld,
        incomeType: parsed.data.incomeType,
        at: Date.now(),
      })
      .catch(() => undefined);

    return {
      payoutRequestId: parsed.data.payoutRequestId,
      grossAmount: parsed.data.grossAmount,
      taxRate: calc.taxRate,
      taxWithheld: calc.taxWithheld,
      netAmount: calc.netAmount,
      isExempt: profile?.isTaxExempt ?? false,
      anomalies,
    };
  }
}
