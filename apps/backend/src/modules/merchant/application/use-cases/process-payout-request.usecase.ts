// SSOT Phase 073 BDD-3 — Payout request use-case (atomic 3% e-Withholding)
// Canonical: apps/backend/src/modules/merchant/application/use-cases/process-payout-request.usecase.ts
// - Guards: tenant ownership + merchant role (controller) + 1000 THB minimum.
// - Atomic: profile lookup -> breakdown -> $transaction insert PENDING row
//   (Gate 7). BDD-3: 50000 -> tax 1500 + fee 10 -> net 48490.
// - Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PayoutRequestSchema } from '@repo/shared';
import {
  assertPayoutMinimum,
  assertTenantOwnership,
} from '../../domain/entities/merchant-account.entity';
import { MerchantTaxCalculator } from '../../domain/services/tax-calculator.domain-service';
import type { MerchantRepository } from '../../infrastructure/repositories/prisma-merchant.repository';

@Injectable()
export class ProcessPayoutRequestUseCase {
  constructor(
    private readonly repo: MerchantRepository,
    private readonly tax: MerchantTaxCalculator,
  ) {}

  async execute(headerTenantId: string | undefined, body: unknown) {
    const raw = (body ?? {}) as Record<string, unknown>;
    const tenantId = assertTenantOwnership(headerTenantId, raw['tenantId'] as string | undefined);
    const parsed = PayoutRequestSchema.safeParse({ ...raw, tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid payout payload');
    assertPayoutMinimum(parsed.data.requestedAmount);
    const profile = await this.repo.findMerchantByTenant(tenantId);
    if (!profile) throw new NotFoundException(`Merchant profile for '${tenantId}' not found.`);
    const { gross, tax, fee, net } = this.tax.breakdown(parsed.data.requestedAmount);
    const row = await this.repo.createPayoutAtomic(profile.id, { gross, tax, fee, net });
    return { payoutId: row.id, grossAmount: gross, withholdingTax: tax, processingFee: fee, netAmount: net, payoutStatus: 'PENDING' };
  }
}
