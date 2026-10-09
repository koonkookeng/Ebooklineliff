// SSOT Phase 090 §5.1 — GroupBuying module wiring
// Canonical: apps/backend/src/modules/group-buying/group-buying.module.ts
// - Repository + Flex builder + create/join/expiry + invite usecase ->
//   GQL + REST. Entitlement writes reuse EntitlementGrantService (012
//   single writer). Wallet refunds ride User.walletBalance via Prisma.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { PrismaGroupRepository } from './infrastructure/persistence/prisma-group.repository';
import { LineFlexGroupBuilder } from './infrastructure/line/line-flex-group.builder';
import { CreateGroupRoomService } from './application/services/create-room.service';
import { JoinGroupRoomService } from './application/services/join-room.service';
import { GroupExpiryService } from './application/services/group-expiry.service';
import { GenerateFlexInviteUseCase } from './application/use-cases/generate-flex-invite.usecase';
import { GroupBuyingResolver } from './api/graphql/group-buying.resolver';
import { GroupBuyingController } from './api/rest/group-buying.controller';

@Module({
  controllers: [GroupBuyingController],
  providers: [
    PrismaGroupRepository,
    LineFlexGroupBuilder,
    EntitlementGrantService,
    GenerateFlexInviteUseCase,
    {
      provide: CreateGroupRoomService,
      useFactory: (repo: PrismaGroupRepository, flex: LineFlexGroupBuilder, redis: RedisClusterService) =>
        new CreateGroupRoomService(repo, flex, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaGroupRepository, LineFlexGroupBuilder, RedisClusterService],
    },
    {
      provide: JoinGroupRoomService,
      useFactory: (
        repo: PrismaGroupRepository,
        redis: RedisClusterService,
        prisma: PrismaService,
        grants: EntitlementGrantService,
      ) =>
        new JoinGroupRoomService(
          repo,
          redis as never,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          grants,
        ),
      inject: [PrismaGroupRepository, RedisClusterService, PrismaService, EntitlementGrantService],
    },
    {
      provide: GroupExpiryService,
      useFactory: (
        repo: PrismaGroupRepository,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) =>
        new GroupExpiryService(
          repo,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
          {
            refundToWallet: async (tx: unknown, userId: string, amount: number) => {
              const db = tx as {
                user: { update: (args: unknown) => Promise<unknown> };
              };
              await db.user.update({
                where: { id: userId },
                data: { walletBalance: { increment: amount } },
              });
            },
          },
        ),
      inject: [PrismaGroupRepository, PrismaService, RedisClusterService],
    },
    {
      provide: GroupBuyingResolver,
      useFactory: (
        create: CreateGroupRoomService,
        join: JoinGroupRoomService,
        repo: PrismaGroupRepository,
      ) => new GroupBuyingResolver(create, join, repo),
      inject: [CreateGroupRoomService, JoinGroupRoomService, PrismaGroupRepository],
    },
  ],
  exports: [CreateGroupRoomService, JoinGroupRoomService, GroupExpiryService, PrismaGroupRepository, GenerateFlexInviteUseCase],
})
export class GroupBuyingModule {}
