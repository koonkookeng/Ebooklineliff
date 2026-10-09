// SSOT Phase 095 Task 3 — Social reading module wiring
// Canonical: apps/backend/src/modules/social-reading/social-reading.module.ts
// - Repository + edge cache + 3 usecases -> GQL + REST. Atomic writes ride
//   Prisma $transaction (Gate 7). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PrismaSocialNoteRepository } from './infrastructure/persistence/prisma-social-note.repository';
import { SocialNoteCacheAdapter } from './infrastructure/redis/social-note-cache.adapter';
import { CreateNoteUsecase } from './application/create-note.usecase';
import { FetchPageNotesUsecase } from './application/fetch-page-notes.usecase';
import { ToggleLikeNoteUsecase } from './application/toggle-like-note.usecase';
import { SocialReadingResolver } from './presentation/graphql/social-reading.resolver';
import { SocialReadingController } from './presentation/rest/social-reading.controller';

@Module({
  controllers: [SocialReadingController],
  providers: [
    PrismaSocialNoteRepository,
    SocialNoteCacheAdapter,
    {
      provide: CreateNoteUsecase,
      useFactory: (repo: PrismaSocialNoteRepository, cache: SocialNoteCacheAdapter, redis: RedisClusterService) =>
        new CreateNoteUsecase(repo, cache, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaSocialNoteRepository, SocialNoteCacheAdapter, RedisClusterService],
    },
    {
      provide: FetchPageNotesUsecase,
      useFactory: (repo: PrismaSocialNoteRepository, cache: SocialNoteCacheAdapter) =>
        new FetchPageNotesUsecase(repo, cache, {
          memberGroupIds: (userId: string) => repo.memberGroupIds(userId),
        }),
      inject: [PrismaSocialNoteRepository, SocialNoteCacheAdapter],
    },
    {
      provide: ToggleLikeNoteUsecase,
      useFactory: (repo: PrismaSocialNoteRepository, cache: SocialNoteCacheAdapter, redis: RedisClusterService) =>
        new ToggleLikeNoteUsecase(repo, cache, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaSocialNoteRepository, SocialNoteCacheAdapter, RedisClusterService],
    },
    {
      provide: SocialReadingResolver,
      useFactory: (
        create: CreateNoteUsecase,
        fetch: FetchPageNotesUsecase,
        likes: ToggleLikeNoteUsecase,
      ) => new SocialReadingResolver(create, fetch, likes),
      inject: [CreateNoteUsecase, FetchPageNotesUsecase, ToggleLikeNoteUsecase],
    },
  ],
  exports: [CreateNoteUsecase, FetchPageNotesUsecase, ToggleLikeNoteUsecase, PrismaSocialNoteRepository],
})
export class SocialReadingModule {}
