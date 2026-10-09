// SSOT Phase 099 §5.1 — Live module wiring
// Canonical: apps/backend/src/modules/live/live.module.ts
// - Prisma seam + entity-gated use-cases (access/signaling/VOD) + SSE chat
//   gateway + REST controller + code-first GQL resolver.
// - RISK_CALL: no aws-sdk/socket.io (HMAC + SSE transports). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { LiveResolver } from '../../api/graphql/resolvers/live.resolver';
import { PrismaLiveRepository } from './infrastructure/persistence/live-session.repository';
import { EntitlementCheckerService } from './domain/services/entitlement-checker.service';
import { AmazonIvsAdapter } from './infrastructure/adapters/amazon-ivs.adapter';
import { CloudflareR2VodAdapter } from './infrastructure/adapters/cloudflare-r2-vod.adapter';
import { LiveChatGateway } from './infrastructure/websocket/live-chat.gateway';
import { MintPlaybackTokenUseCase, type LiveBus } from './application/use-cases/mint-ivs-token.usecase';
import { HandleWebrtcSignalingUseCase } from './application/use-cases/handle-webrtc-signaling.usecase';
import { ConvertLiveToVodUseCase } from './application/use-cases/convert-live-to-vod.usecase';
import { LiveController } from './live.controller';

function busOf(redis: RedisClusterService): LiveBus {
  return {
    xadd: (stream: string, fields: Record<string, string | number>) =>
      redis.xaddPipeline(stream, [fields]),
    setGrant: (key: string, token: string, ttlSec: number) =>
      redis.set(key, token, 'EX', ttlSec).then(() => undefined),
  };
}

@Module({
  controllers: [LiveController],
  providers: [
    PrismaLiveRepository,
    AmazonIvsAdapter,
    CloudflareR2VodAdapter,
    {
      provide: EntitlementCheckerService,
      useFactory: (repo: PrismaLiveRepository) => new EntitlementCheckerService(repo),
      inject: [PrismaLiveRepository],
    },
    {
      provide: MintPlaybackTokenUseCase,
      useFactory: (repo: PrismaLiveRepository, gate: EntitlementCheckerService, vendor: AmazonIvsAdapter, redis: RedisClusterService) =>
        new MintPlaybackTokenUseCase(repo, gate, vendor, busOf(redis)),
      inject: [PrismaLiveRepository, EntitlementCheckerService, AmazonIvsAdapter, RedisClusterService],
    },
    {
      provide: HandleWebrtcSignalingUseCase,
      useFactory: (repo: PrismaLiveRepository, gate: EntitlementCheckerService, redis: RedisClusterService) =>
        new HandleWebrtcSignalingUseCase(repo, gate, busOf(redis)),
      inject: [PrismaLiveRepository, EntitlementCheckerService, RedisClusterService],
    },
    {
      provide: ConvertLiveToVodUseCase,
      useFactory: (repo: PrismaLiveRepository, vod: CloudflareR2VodAdapter, redis: RedisClusterService) =>
        new ConvertLiveToVodUseCase(repo, vod, busOf(redis)),
      inject: [PrismaLiveRepository, CloudflareR2VodAdapter, RedisClusterService],
    },
    {
      provide: LiveChatGateway,
      useFactory: (repo: PrismaLiveRepository, redis: RedisClusterService) =>
        new LiveChatGateway(repo, busOf(redis)),
      inject: [PrismaLiveRepository, RedisClusterService],
    },
    {
      provide: LiveResolver,
      useFactory: (access: MintPlaybackTokenUseCase, repo: PrismaLiveRepository) =>
        new LiveResolver(access, repo),
      inject: [MintPlaybackTokenUseCase, PrismaLiveRepository],
    },
  ],
  exports: [MintPlaybackTokenUseCase, HandleWebrtcSignalingUseCase, ConvertLiveToVodUseCase, LiveChatGateway, PrismaLiveRepository],
})
export class LiveModule {}
