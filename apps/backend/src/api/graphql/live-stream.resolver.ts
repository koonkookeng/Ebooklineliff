// SSOT Phase 100 §3.2 — Live gatekeeper GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/live-stream.resolver.ts
// - Mutations issueLivePlaybackToken + sendLiveHeartbeat (kick delivery rides
//   the SSE REST stream — GQL subscriptions need WS, out of scope).
// - Zero new deps.
import { Args, Field, Float, ID, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { LiveGatekeeperService } from '../../modules/stream/live-gatekeeper.service';

@ObjectType('LiveWatermarkPayload')
class LiveWatermarkPayloadGql {
  @Field()
  userIdHash!: string;

  @Field()
  displayName!: string;

  @Field()
  ipAddress!: string;

  @Field()
  timestamp!: string;
}

@ObjectType('LivePlaybackTokenPayload')
class LivePlaybackTokenPayloadGql {
  @Field()
  accessStatus!: string;

  @Field({ nullable: true })
  playbackToken?: string | null;

  @Field({ nullable: true })
  hlsStreamUrl?: string | null;

  @Field(() => Float)
  tokenExpiresAt!: number;

  @Field(() => Int)
  heartbeatIntervalSec!: number;

  @Field(() => LiveWatermarkPayloadGql, { nullable: true })
  watermarkPayload?: LiveWatermarkPayloadGql | null;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; ip: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  return { userId: user.id, ip: headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown' };
}

function toGql(r: {
  accessStatus: string;
  playbackToken: string | null;
  hlsStreamUrl: string | null;
  tokenExpiresAt: number;
  heartbeatIntervalSec: number;
  watermarkPayload: { userIdHash: string; displayName: string; ipAddress: string; timestamp: string };
}): LivePlaybackTokenPayloadGql {
  const out = new LivePlaybackTokenPayloadGql();
  out.accessStatus = r.accessStatus;
  out.playbackToken = r.playbackToken;
  out.hlsStreamUrl = r.hlsStreamUrl;
  out.tokenExpiresAt = r.tokenExpiresAt;
  out.heartbeatIntervalSec = r.heartbeatIntervalSec;
  const wm = new LiveWatermarkPayloadGql();
  wm.userIdHash = r.watermarkPayload.userIdHash;
  wm.displayName = r.watermarkPayload.displayName;
  wm.ipAddress = r.watermarkPayload.ipAddress;
  wm.timestamp = r.watermarkPayload.timestamp;
  out.watermarkPayload = wm;
  return out;
}

@Injectable()
@Resolver('LiveStream')
export class LiveStreamResolver {
  constructor(private readonly gate: LiveGatekeeperService) {}

  @Query('liveGatekeeperHealth')
  liveGatekeeperHealth(): string {
    return 'ok';
  }

  @Mutation('issueLivePlaybackToken')
  async issueLivePlaybackToken(
    @Args('liveRoomId') liveRoomId: string,
    @Args('deviceFingerprint') deviceFingerprint: string,
    @Context() ctx: LooseCtx,
  ) {
    const { userId, ip } = ctxOf(ctx);
    if (!liveRoomId || !deviceFingerprint) throw new BadRequestException('Invalid token request');
    return toGql(await this.gate.validateAndIssuePlaybackToken({ userId, liveRoomId, deviceFingerprint, clientIp: ip }));
  }

  @Mutation('sendLiveHeartbeat')
  sendLiveHeartbeat(
    @Args('sessionToken') sessionToken: string,
    @Args('liveRoomId') liveRoomId: string,
    @Args('currentPlaybackSec') currentPlaybackSec: number,
    @Args('deviceFingerprint', { nullable: true }) deviceFingerprint: string | null,
    @Context() ctx: LooseCtx,
  ) {
    const { userId, ip } = ctxOf(ctx);
    // deviceFingerprint is optional over GQL (native clients pass it; without
    // it the session token itself is the bearer secret).
    const skip = !deviceFingerprint;
    return this.gate
      .heartbeat({ sessionToken, liveRoomId, userId, currentPlaybackSec, deviceFingerprint: deviceFingerprint ?? 'gql', clientIp: ip, skipDeviceCheck: skip })
      .then((r) => r.status === 'OK');
  }
}

export { LivePlaybackTokenPayloadGql };
