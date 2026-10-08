// SSOT Phase 079 §5.1 — Affiliate module wiring
// Canonical: apps/backend/src/modules/affiliate/affiliate.module.ts
// (legacy class name AffiliateModuleModule renamed — no external importers).
// - Tree resolve -> fraud screen -> atomic commission; Flex builder; payout
//   with 3% withholding; REST + GQL. Redis velocity/fraud streams via infra.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaAffiliateRepository } from './infrastructure/prisma-affiliate.repository';
import { AffiliateTreeService } from './services/affiliate-tree.service';
import { AntiFraudService } from './services/anti-fraud.service';
import { CommissionEngineService } from './services/commission-engine.service';
import { FlexMessageBuilderService } from './services/flex-message-builder.service';
import { PayoutService } from './services/payout.service';
import { AffiliateController } from './controllers/affiliate.controller';
import { AffiliateResolver } from './resolvers/affiliate.resolver';

const velocityOf = (redis: RedisClusterService) => ({
  bump: async (key: string, windowSec: number): Promise<number> => {
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSec);
      return n;
    } catch {
      return 1;
    }
  },
});

@Module({
  controllers: [AffiliateController],
  providers: [
    PrismaAffiliateRepository,
    FlexMessageBuilderService,
    {
      provide: AffiliateTreeService,
      useFactory: (repo: PrismaAffiliateRepository) => new AffiliateTreeService(repo),
      inject: [PrismaAffiliateRepository],
    },
    {
      provide: AntiFraudService,
      useFactory: (redis: RedisClusterService) =>
        new AntiFraudService(
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]).catch(() => undefined),
          },
          velocityOf(redis),
        ),
      inject: [RedisClusterService],
    },
    {
      provide: CommissionEngineService,
      useFactory: (
        repo: PrismaAffiliateRepository,
        prisma: PrismaService,
        tree: AffiliateTreeService,
        fraud: AntiFraudService,
        redis: RedisClusterService,
      ) =>
        new CommissionEngineService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          tree,
          fraud,
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]).catch(() => undefined),
          },
        ),
      inject: [PrismaAffiliateRepository, PrismaService, AffiliateTreeService, AntiFraudService, RedisClusterService],
    },
    {
      provide: PayoutService,
      useFactory: (repo: PrismaAffiliateRepository) => new PayoutService(repo),
      inject: [PrismaAffiliateRepository],
    },
    {
      provide: AffiliateResolver,
      useFactory: (
        payouts: PayoutService,
        flex: FlexMessageBuilderService,
        repo: PrismaAffiliateRepository,
      ) => new AffiliateResolver(payouts, flex, repo),
      inject: [PayoutService, FlexMessageBuilderService, PrismaAffiliateRepository],
    },
  ],
  exports: [CommissionEngineService, PayoutService, AffiliateTreeService, PrismaAffiliateRepository],
})
export class AffiliateModule {}
