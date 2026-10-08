// SSOT Phase 081 Task 4 — Commission module wiring
// Canonical: apps/backend/src/modules/commission/commission.module.ts
// (legacy class name CommissionModuleModule renamed — no external importers).
// - Pure rule-driven split math; persistence stays in the finance posting
//   engine (single writer, zero-redundant policy).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { CommissionCalculatorService } from './application/commission-calculator.service';

@Module({
  providers: [
    {
      provide: CommissionCalculatorService,
      useFactory: (prisma: PrismaService) =>
        new CommissionCalculatorService({
          commissionRule: async (productId: string | null) => {
            const db = prisma as unknown as {
              commissionRule: {
                findUnique(a: unknown): Promise<{ platformFeePercent: unknown; tier1Percent: unknown; tier2Percent: unknown } | null>;
                findFirst(a: unknown): Promise<{ platformFeePercent: unknown; tier1Percent: unknown; tier2Percent: unknown } | null>;
              };
            };
            const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? NaN);
            if (productId) {
              const scoped = await db.commissionRule.findUnique({ where: { productId } }).catch(() => null);
              if (scoped && [scoped.platformFeePercent, scoped.tier1Percent, scoped.tier2Percent].every((v) => Number.isFinite(toNum(v)))) {
                return {
                  platformFeePercent: toNum(scoped.platformFeePercent),
                  tier1Percent: toNum(scoped.tier1Percent),
                  tier2Percent: toNum(scoped.tier2Percent),
                };
              }
            }
            const global = await db.commissionRule.findFirst({ where: { productId: null } }).catch(() => null);
            if (global) {
              return {
                platformFeePercent: toNum(global.platformFeePercent) || 5,
                tier1Percent: toNum(global.tier1Percent) || 10,
                tier2Percent: toNum(global.tier2Percent) || 2,
              };
            }
            return { platformFeePercent: 5, tier1Percent: 10, tier2Percent: 2 };
          },
        }),
      inject: [PrismaService],
    },
  ],
  exports: [CommissionCalculatorService],
})
export class CommissionModule {}
