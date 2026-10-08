// SSOT Phase 081 §5.1 — Finance module wiring
// Canonical: apps/backend/src/modules/finance/finance.module.ts
// (legacy class name FinanceModuleModule renamed — no external importers).
// - Posting (order revenue, atomic) -> balances (overview/statements/
//   reconcile probe) -> tax (3% + R2 PDF certs) -> payout (locked, taxed).
// - Referral uplines resolve read-only from the order buyer's 079
//   AffiliateReferrals chain (never writes affiliate tables).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { RedisBalanceCache } from './infrastructure/redis-balance.cache';
import { PostingEngineService } from './application/posting-engine.service';
import { BalanceCalculatorService } from './application/balance-calculator.service';
import { TaxCalculatorService } from './application/tax-calculator.service';
import { FinancePayoutService } from './application/payout.service';
import { FinanceController } from './presentation/finance.controller';
import { FinanceResolver } from './presentation/finance.resolver';

@Module({
  controllers: [FinanceController],
  providers: [
    PrismaLedgerRepository,
    RedisBalanceCache,
    {
      provide: PostingEngineService,
      useFactory: (
        repo: PrismaLedgerRepository,
        cache: RedisBalanceCache,
        prisma: PrismaService,
      ) =>
        new PostingEngineService(
          repo,
          cache,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            uplinesOf: async (buyerId: string): Promise<Array<string | null>> => {
              const db = prisma as unknown as {
                user: { findUnique(a: unknown): Promise<{ referredById: string | null } | null> };
              };
              const chain: Array<string | null> = [];
              let cursor: string | null = buyerId;
              const seen = new Set<string>([buyerId]);
              for (let i = 0; i < 2; i++) {
                const row: { referredById: string | null } | null = await db.user
                  .findUnique({ where: { id: cursor } })
                  .catch(() => null);
                const parent: string | null = row?.referredById ?? null;
                if (!parent || seen.has(parent)) break;
                seen.add(parent);
                chain.push(parent);
                cursor = parent;
              }
              return chain;
            },
          },
        ),
      inject: [PrismaLedgerRepository, RedisBalanceCache, PrismaService],
    },
    {
      provide: BalanceCalculatorService,
      useFactory: (repo: PrismaLedgerRepository, cache: RedisBalanceCache) =>
        new BalanceCalculatorService(repo, cache),
      inject: [PrismaLedgerRepository, RedisBalanceCache],
    },
    {
      provide: TaxCalculatorService,
      useFactory: (repo: PrismaLedgerRepository, r2: R2StorageService) =>
        new TaxCalculatorService(repo, r2),
      inject: [PrismaLedgerRepository, R2StorageService],
    },
    {
      provide: FinancePayoutService,
      useFactory: (
        repo: PrismaLedgerRepository,
        cache: RedisBalanceCache,
        prisma: PrismaService,
        tax: TaxCalculatorService,
      ) =>
        new FinancePayoutService(
          repo,
          cache,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          tax,
        ),
      inject: [PrismaLedgerRepository, RedisBalanceCache, PrismaService, TaxCalculatorService],
    },
    {
      provide: FinanceResolver,
      useFactory: (balances: BalanceCalculatorService, payouts: FinancePayoutService) =>
        new FinanceResolver(balances, payouts),
      inject: [BalanceCalculatorService, FinancePayoutService],
    },
  ],
  exports: [PostingEngineService, BalanceCalculatorService, TaxCalculatorService, FinancePayoutService, PrismaLedgerRepository],
})
export class FinanceModule {}
