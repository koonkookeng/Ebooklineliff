// SSOT Phase 099 §5.1 + Phase 101 §5.1 — Live module wiring
// Canonical: apps/backend/src/modules/live/live.module.ts
// - 099: Prisma seam + entity-gated use-cases (access/signaling/VOD) + SSE
//   chat gateway + REST controller + code-first GQL resolver.
// - 101: interaction engines (stream/chat/poll/raise) + SSE socket gateway
//   (handshake via the 100 gatekeeper from StreamModule) + GQL intents.
// - RISK_CALL: no aws-sdk/WS libs (HMAC + SSE transports). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { StreamModule } from '../stream/stream.module';
import { LiveGatekeeperService } from '../stream/live-gatekeeper.service';
import { LiveResolver } from '../../api/graphql/resolvers/live.resolver';
import { LiveInteractionResolver } from '../../api/graphql/resolvers/live/live-interaction.resolver';
import { LiveSocketGateway } from '../../gateways/live-socket/live-socket.gateway';
import { LiveSocketGuard } from '../../gateways/live-socket/guards/live-socket.guard';
import { RedisFanoutAdapter } from '../../gateways/live-socket/adapters/redis-fanout.adapter';
import { PrismaLiveRepository } from './infrastructure/persistence/live-session.repository';
import { PrismaLiveInteractionRepository } from './repositories/live-interaction.repository';
import { EntitlementCheckerService } from './domain/services/entitlement-checker.service';
import { AmazonIvsAdapter } from './infrastructure/adapters/amazon-ivs.adapter';
import { CloudflareR2VodAdapter } from './infrastructure/adapters/cloudflare-r2-vod.adapter';
import { LiveChatGateway } from './infrastructure/websocket/live-chat.gateway';
import { LiveStreamService } from './services/live-stream.service';
import { LiveChatEngine } from './services/live-chat.engine';
import { LivePollEngine } from './services/live-poll.engine';
import { HandRaiseQueue } from './services/hand-raise.queue';
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

function fanoutOf(redis: RedisClusterService) {
  return {
    xaddPipeline: (stream: string, batch: Array<Record<string, string | number>>) =>
      redis.xaddPipeline(stream, batch),
  };
}

@Module({
  imports: [StreamModule],
  controllers: [LiveController],
  providers: [
    PrismaLiveRepository,
    PrismaLiveInteractionRepository,
    AmazonIvsAdapter,
    CloudflareR2VodAdapter,
    RedisFanoutAdapter,
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
    // ---- Phase 101 interaction engines ----
    {
      provide: LiveStreamService,
      useFactory: (sessions: PrismaLiveRepository, interaction: PrismaLiveInteractionRepository, redis: RedisClusterService) =>
        new LiveStreamService(sessions, interaction, {
          incr: (k: string) => redis.incr(k),
          decr: (k: string) => redis.decrby(k, 1),
          xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => redis.xaddPipeline(s, b),
        }),
      inject: [PrismaLiveRepository, PrismaLiveInteractionRepository, RedisClusterService],
    },
    {
      provide: LiveChatEngine,
      useFactory: (sessions: PrismaLiveRepository, interaction: PrismaLiveInteractionRepository, redis: RedisClusterService) =>
        new LiveChatEngine(sessions, interaction, fanoutOf(redis)),
      inject: [PrismaLiveRepository, PrismaLiveInteractionRepository, RedisClusterService],
    },
    {
      provide: LivePollEngine,
      useFactory: (sessions: PrismaLiveRepository, interaction: PrismaLiveInteractionRepository, redis: RedisClusterService) =>
        new LivePollEngine(sessions, interaction, {
          get: (k: string) => redis.get(k),
          set: (k: string, v: string, ...a: Array<string | number>) => redis.set(k, v, ...a),
          zincrby: (k: string, n: number, m: string) => redis.zincrby(k, n, m),
          xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => redis.xaddPipeline(s, b),
        }, fanoutOf(redis)),
      inject: [PrismaLiveRepository, PrismaLiveInteractionRepository, RedisClusterService],
    },
    {
      provide: HandRaiseQueue,
      useFactory: (sessions: PrismaLiveRepository, interaction: PrismaLiveInteractionRepository, redis: RedisClusterService) =>
        new HandRaiseQueue(sessions, interaction, {
          zadd: (k: string, s: number, m: string) => redis.zadd(k, s, m),
          zrange: (k: string, s: number, e: number) => redis.zrange(k, s, e),
          zrem: (k: string, m: string) => redis.zrem(k, m),
          xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => redis.xaddPipeline(s, b),
        }, fanoutOf(redis)),
      inject: [PrismaLiveRepository, PrismaLiveInteractionRepository, RedisClusterService],
    },
    {
      provide: LiveSocketGuard,
      useFactory: (gate: LiveGatekeeperService, vendor: AmazonIvsAdapter) =>
        new LiveSocketGuard({
          verifyToken: (token: string) => {
            const room = gate.verifyToken(token);
            if (room) return { liveRoomId: room.liveRoomId, userId: room.userId };
            const session = vendor.verify(token);
            if (session) return { liveRoomId: session.sessionId, userId: session.userId };
            return null;
          },
        }),
      inject: [LiveGatekeeperService, AmazonIvsAdapter],
    },
    {
      provide: LiveSocketGateway,
      useFactory: (redis: RedisClusterService, gate: LiveGatekeeperService, vendor: AmazonIvsAdapter) =>
        new LiveSocketGateway(
          {
            xaddPipeline: (s: string, b: Array<Record<string, string | number>>) => redis.xaddPipeline(s, b),
            incr: (k: string) => redis.incr(k),
            decr: (k: string) => redis.decrby(k, 1),
          },
          {
            publish: (c: string, m: string) => redis.publish(c, m),
            subscribe: (c: string, h: (m: string) => void) => redis.subscribe(c, h),
          },
          {
            // Composite handshake: 100 room tokens first, 099 session
            // tokens as fallback (mapped to their session room).
            verifyToken: (token: string) => {
              const room = gate.verifyToken(token);
              if (room) return { liveRoomId: room.liveRoomId, userId: room.userId };
              const session = vendor.verify(token);
              if (session) return { liveRoomId: session.sessionId, userId: session.userId };
              return null;
            },
          },
        ),
      inject: [RedisClusterService, LiveGatekeeperService, AmazonIvsAdapter],
    },
    {
      provide: LiveInteractionResolver,
      useFactory: (
        streams: LiveStreamService,
        chat: LiveChatEngine,
        polls: LivePollEngine,
        raises: HandRaiseQueue,
      ) => new LiveInteractionResolver(streams, chat, polls, raises),
      inject: [LiveStreamService, LiveChatEngine, LivePollEngine, HandRaiseQueue],
    },
  ],
  exports: [MintPlaybackTokenUseCase, HandleWebrtcSignalingUseCase, ConvertLiveToVodUseCase, LiveChatGateway, PrismaLiveRepository, LiveStreamService, LiveChatEngine, LivePollEngine, HandRaiseQueue, LiveSocketGateway, PrismaLiveInteractionRepository],
})
export class LiveModule {}
