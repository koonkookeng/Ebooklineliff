// SSOT Phase 089 §5.1 — Gift module wiring
// Canonical: apps/backend/src/modules/gift/gift.module.ts
// (legacy class name GiftModuleModule renamed — no importers.)
// - Repository + Flex builder + create/claim/cron + Flex usecase ->
//   GQL + REST. Entitlement writes reuse EntitlementGrantService (012
//   single writer — wallet-module precedent: direct provision).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { PrismaGiftRepository } from './infrastructure/persistence/prisma-gift.repository';
import { LineFlexGiftBuilder } from './infrastructure/line/line-flex-gift.builder';
import { CreateGiftOrderService } from './application/services/create-gift-order.service';
import { ClaimGiftService } from './application/services/claim-gift.service';
import { GiftCronService } from './application/services/gift-cron.service';
import { GenerateFlexCardUseCase } from './application/use-cases/generate-flex-card.usecase';
import { GiftResolver } from './api/graphql/gift.resolver';
import { GiftClaimController } from './api/rest/gift-claim.controller';

@Module({
  controllers: [GiftClaimController],
  providers: [
    PrismaGiftRepository,
    LineFlexGiftBuilder,
    EntitlementGrantService,
    GenerateFlexCardUseCase,
    {
      provide: CreateGiftOrderService,
      useFactory: (repo: PrismaGiftRepository, flex: LineFlexGiftBuilder, redis: RedisClusterService) =>
        new CreateGiftOrderService(repo, flex, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaGiftRepository, LineFlexGiftBuilder, RedisClusterService],
    },
    {
      provide: ClaimGiftService,
      useFactory: (
        repo: PrismaGiftRepository,
        redis: RedisClusterService,
        prisma: PrismaService,
        grants: EntitlementGrantService,
      ) =>
        new ClaimGiftService(
          repo,
          redis as never,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          grants,
        ),
      inject: [PrismaGiftRepository, RedisClusterService, PrismaService, EntitlementGrantService],
    },
    {
      provide: GiftCronService,
      useFactory: (
        repo: PrismaGiftRepository,
        prisma: PrismaService,
        redis: RedisClusterService,
        grants: EntitlementGrantService,
      ) =>
        new GiftCronService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
          grants,
        ),
      inject: [PrismaGiftRepository, PrismaService, RedisClusterService, EntitlementGrantService],
    },
    {
      provide: GiftResolver,
      useFactory: (
        create: CreateGiftOrderService,
        claim: ClaimGiftService,
        repo: PrismaGiftRepository,
      ) => new GiftResolver(create, claim, repo),
      inject: [CreateGiftOrderService, ClaimGiftService, PrismaGiftRepository],
    },
  ],
  exports: [CreateGiftOrderService, ClaimGiftService, GiftCronService, PrismaGiftRepository, GenerateFlexCardUseCase],
})
export class GiftModule {}
