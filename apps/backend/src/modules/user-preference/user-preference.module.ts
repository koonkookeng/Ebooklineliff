// SSOT Phase 066 §5.1 — UserPreferenceModule (reading preference wiring)
// Canonical: apps/backend/src/modules/user-preference/user-preference.module.ts
// (legacy src/backend/modules/user-preference/user-preference.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 027–066).
// - Prisma via global InfraModule; rooms via RedisPubSubAdapter over the
//   RedisClusterService (publish/subscribe ports); analytics via xadd.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { RedisPubSubAdapter } from '../../infra/redis/redis-pubsub.adapter';
import { UserPreferenceRepository } from './user-preference.repository';
import { UserPreferenceService } from './user-preference.service';
import { UserPreferenceResolver } from './user-preference.resolver';
import { PreferenceSyncController } from './controllers/preference-sync.controller';

@Module({
  controllers: [PreferenceSyncController],
  providers: [
    {
      provide: RedisPubSubAdapter,
      useFactory: (edge: RedisClusterService): RedisPubSubAdapter => new RedisPubSubAdapter(edge),
      inject: [RedisClusterService],
    },
    {
      provide: UserPreferenceRepository,
      useFactory: (prisma: PrismaService): UserPreferenceRepository =>
        new UserPreferenceRepository(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: UserPreferenceService,
      useFactory: (
        repo: UserPreferenceRepository,
        edge: RedisClusterService,
        rooms: RedisPubSubAdapter,
      ): UserPreferenceService => new UserPreferenceService(repo, edge as never, rooms),
      inject: [UserPreferenceRepository, RedisClusterService, RedisPubSubAdapter],
    },
    UserPreferenceResolver,
  ],
  exports: [UserPreferenceService, UserPreferenceRepository],
})
export class UserPreferenceModule {}
