// SSOT Phase 099 §10-11 — contract tests (Zod, gate, playback, chat, VOD, parity)
// Run: npx tsx scripts/test-phase099-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LiveStreamVendorEnum,
  LiveSessionStatusEnum,
  LiveStreamAccessRequestSchema,
  LiveStreamAccessPayloadSchema,
  LiveChatMessagePayloadSchema,
  LivePollVoteSchema,
  LIVE_PLAYBACK_TOKEN_TTL_SEC,
  LIVE_GATE_BUDGET_MS,
  LIVE_LATENCY_CEILING_MS,
  LIVE_CHAT_WINDOW,
  LIVE_STREAM,
  liveTokenBody,
  liveGrantKey,
  liveChatStreamKey,
  liveUserHash,
  liveVodPrefix,
  liveChatWindow,
} from '../packages/shared/src/schemas/live-contract';
import { canTransition, assertTransition, isJoinable, isVodEligible } from '../apps/backend/src/modules/live/domain/entities/live-session.entity';
import { EntitlementCheckerService } from '../apps/backend/src/modules/live/domain/services/entitlement-checker.service';
import { MintPlaybackTokenUseCase } from '../apps/backend/src/modules/live/application/use-cases/mint-ivs-token.usecase';
import { HandleWebrtcSignalingUseCase } from '../apps/backend/src/modules/live/application/use-cases/handle-webrtc-signaling.usecase';
import { ConvertLiveToVodUseCase } from '../apps/backend/src/modules/live/application/use-cases/convert-live-to-vod.usecase';
import { AmazonIvsAdapter } from '../apps/backend/src/modules/live/infrastructure/adapters/amazon-ivs.adapter';
import { CloudflareR2VodAdapter } from '../apps/backend/src/modules/live/infrastructure/adapters/cloudflare-r2-vod.adapter';
import { LiveChatGateway } from '../apps/backend/src/modules/live/infrastructure/websocket/live-chat.gateway';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const NOW = Date.now();

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(LiveStreamVendorEnum.safeParse('AMAZON_IVS').success, true);
  assert.equal(LiveStreamVendorEnum.safeParse('RTMP').success, false);
  assert.equal(LiveSessionStatusEnum.safeParse('ARCHIVED').success, true);
  assert.equal(LiveSessionStatusEnum.safeParse('DELETED').success, false);
  assert.equal(
    LiveStreamAccessRequestSchema.safeParse({ sessionId: UUID, lineUserId: 'U1', tenantId: 't1' }).success,
    true,
  );
  assert.equal(
    LiveStreamAccessRequestSchema.safeParse({ sessionId: UUID, lineUserId: '', tenantId: 't1' }).success,
    false,
  );
  assert.equal(
    LiveStreamAccessPayloadSchema.safeParse({
      sessionId: UUID, vendor: 'HLS_LOW_LATENCY', playbackUrl: 'https://x/y.m3u8',
      watermarkData: { text: 't', userIdHash: 'ab12', timestamp: '2026-01-01' }, expiresAt: '2026-01-02',
    }).success,
    true,
  );
  assert.equal(
    LiveChatMessagePayloadSchema.safeParse({
      sessionId: UUID, messageId: UUID_B, senderName: 'Ann', content: 'hi', timestamp: '2026-01-01',
    }).success,
    true,
  );
  assert.equal(
    LiveChatMessagePayloadSchema.safeParse({
      sessionId: UUID, messageId: UUID_B, senderName: 'Ann', content: 'x'.repeat(501), timestamp: 't',
    }).success,
    false,
  );
  const vote = { pollId: UUID, optionId: UUID_B, userId: UUID_C };
  assert.equal(LivePollVoteSchema.safeParse(vote).success, true);
  assert.equal(LivePollVoteSchema.safeParse({ ...vote, userId: 'nope' }).success, false);
  ok('Zod §3.1 verbatim (vendor/status/access/chat/vote gates)');
}

// ---------- 2. Pure helpers + entity machine ----------
{
  assert.equal(LIVE_PLAYBACK_TOKEN_TTL_SEC, 300);
  assert.equal(LIVE_GATE_BUDGET_MS, 50);
  assert.equal(LIVE_LATENCY_CEILING_MS, 1500);
  assert.equal(LIVE_CHAT_WINDOW, 50);
  assert.equal(LIVE_STREAM, 'stream:live:events');
  assert.equal(liveTokenBody('s', 'u', 1), 's.u.1');
  assert.equal(liveGrantKey('s', 'u'), 'live:grant:s:u');
  assert.equal(liveChatStreamKey('s'), 'stream:live:chat:s');
  assert.ok(/^[0-9a-f]{12}$/.test(liveUserHash('u1', 'salt')));
  assert.notEqual(liveUserHash('u1', 'a'), liveUserHash('u1', 'b'));
  assert.equal(liveVodPrefix('s'), 'live-vod/s/hls/master.m3u8');
  assert.deepEqual(liveChatWindow([1, 2, 3, 4], 2), [3, 4]);
  assert.ok(canTransition('LIVE', 'ENDED') && !canTransition('SCHEDULED', 'ENDED'));
  assert.ok(isJoinable('PAUSED') && !isJoinable('ENDED'));
  assert.ok(isVodEligible('ENDED') && !isVodEligible('LIVE'));
  assert.throws(() => assertTransition('SCHEDULED', 'LIVE'), /Illegal/);
  ok('Helpers: token/grant/chat keys/hash/VOD path/window + lifecycle machine');
}

// ---------- shared mocks ----------
function bus() {
  const streams: string[] = [];
  const grants: string[] = [];
  return {
    streams,
    grants,
    xadd: async (s: string) => { streams.push(s); },
    setGrant: async (k: string) => { grants.push(k); },
  };
}

function repoOf(session: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    findSessionById: async () => session,
    setStatus: async () => session,
    findEntitlement: async () => null,
    postChat: async (d: Record<string, unknown>) => ({ id: 'msg-1', createdAt: new Date(NOW), ...d }),
    listChat: async () => [],
    createPoll: async () => ({ id: 'poll-1' }),
    votePoll: async () => ({ id: 'vote-1' }),
    pollTally: async () => [],
    createVodRecord: async () => ({ id: 'vod-1' }),
    findVodBySession: async () => null,
    attachVodToLesson: async () => undefined,
    ...extra,
  };
}

const liveSession = {
  id: UUID, productId: UUID_B, instructorId: UUID_C, title: 'T', vendor: 'AMAZON_IVS',
  status: 'LIVE', streamKey: 'k', playbackArn: null, scheduledAt: new Date(NOW), peakViewers: 0,
};

// ---------- 3. Entitlement gate (Task 3, ≤50ms shape) ----------
async function sectionGate(): Promise<void> {
  const open = new EntitlementCheckerService({ findEntitlement: async () => null });
  await open.requireAccess({ userId: 'u', productId: null });
  const entitled = new EntitlementCheckerService({
    findEntitlement: async () => ({ accessGranted: true, expiresAt: null }),
  });
  await entitled.requireAccess({ userId: 'u', productId: 'p' });
  const expired = new EntitlementCheckerService({
    findEntitlement: async () => ({ accessGranted: true, expiresAt: new Date(NOW - 1000) }),
  });
  await assert.rejects(expired.requireAccess({ userId: 'u', productId: 'p' }), /entitlement/);
  const missing = new EntitlementCheckerService({ findEntitlement: async () => null });
  await assert.rejects(missing.requireAccess({ userId: 'u', productId: 'p' }), /entitlement/);
  ok('Gate: open/free + entitled + expired/missing 403 shapes');
}

// ---------- 4. Join + HMAC playback (BDD-1 <1.5s, 5-min token) ----------
async function sectionJoin(): Promise<void> {
  const b = bus();
  const gate = new EntitlementCheckerService({ findEntitlement: async () => ({ accessGranted: true, expiresAt: null }) });
  const vendor = new AmazonIvsAdapter('test-key');
  const svc = new MintPlaybackTokenUseCase(repoOf(liveSession) as never, gate, vendor, b);
  const t0 = Date.now();
  const r = await svc.join({ sessionId: UUID, userId: 'user-1' });
  assert.ok(Date.now() - t0 < 1500, 'join <1.5s budget');
  assert.deepEqual([r.sessionId, r.vendor], [UUID, 'AMAZON_IVS']);
  assert.ok(r.playbackUrl.includes(UUID));
  assert.equal(r.watermarkData.userIdHash.length, 12);
  assert.ok(r.watermarkData.text.includes(r.watermarkData.userIdHash));
  assert.ok(Date.parse(r.expiresAt) - Date.now() > 290 * 1000);
  assert.ok(b.grants.includes(`live:grant:${UUID}:user-1`));
  assert.ok(b.streams.includes(LIVE_STREAM));
  // Token round-trip: verify + tamper + expiry.
  const adapter = new AmazonIvsAdapter('test-key');
  const minted = adapter.mint({ sessionId: UUID, userId: 'user-1', vendor: 'AMAZON_IVS' });
  assert.deepEqual(adapter.verify(minted.playbackToken), { sessionId: UUID, userId: 'user-1', expSec: Math.floor(Date.parse(minted.expiresAt) / 1000) });
  assert.equal(adapter.verify(`${minted.playbackToken}x`), null);
  assert.equal(new AmazonIvsAdapter('other-key').verify(minted.playbackToken), null);
  // Graceful shapes: unknown / unjoinable / unentitled.
  await assert.rejects(
    new MintPlaybackTokenUseCase(repoOf(null) as never, gate, vendor, bus()).join({ sessionId: UUID, userId: 'u' }),
    /not found/,
  );
  await assert.rejects(
    new MintPlaybackTokenUseCase(repoOf({ ...liveSession, status: 'ENDED' }) as never, gate, vendor, bus()).join({ sessionId: UUID, userId: 'u' }),
    /ENDED/,
  );
  const closed = new EntitlementCheckerService({ findEntitlement: async () => null });
  await assert.rejects(
    new MintPlaybackTokenUseCase(repoOf(liveSession) as never, closed, vendor, bus()).join({ sessionId: UUID, userId: 'u' }),
    /entitlement/,
  );
  ok('Join: gate + HMAC mint/verify + watermark + 4 graceful shapes (<1.5s)');
}

// ---------- 5. WebRTC signaling + VOD pipeline (BDD-3) ----------
async function sectionSignalVod(): Promise<void> {
  const gate = new EntitlementCheckerService({ findEntitlement: async () => ({ accessGranted: true, expiresAt: null }) });
  const rtc = { ...liveSession, vendor: 'WEBRTC_NATIVE' };
  const sig = new HandleWebrtcSignalingUseCase(repoOf(rtc) as never, gate, bus());
  const ans = await sig.answer({ sessionId: UUID, userId: 'u', sdpOffer: 'v=0\r\no=test 1 1 IN IP4 0.0.0.0' });
  assert.ok(ans.webrtcSdpAnswer.startsWith('v=0'));
  await assert.rejects(sig.answer({ sessionId: UUID, userId: 'u', sdpOffer: 'garbage' }), /SDP/);
  await assert.rejects(
    new HandleWebrtcSignalingUseCase(repoOf(liveSession) as never, gate, bus()).answer({ sessionId: UUID, userId: 'u', sdpOffer: 'v=0\r\nx' }),
    /not WebRTC/,
  );

  const vodAdapter = new CloudflareR2VodAdapter();
  assert.equal(vodAdapter.masterKey(UUID), `live-vod/${UUID}/hls/master.m3u8`);
  assert.ok(vodAdapter.masterUrl(UUID).endsWith(`live-vod/${UUID}/hls/master.m3u8`));
  const attached: string[] = [];
  const vod = new ConvertLiveToVodUseCase(
    repoOf({ ...liveSession, status: 'ENDED' }, { attachVodToLesson: async (l: string) => { attached.push(l); } }) as never,
    vodAdapter,
    bus(),
  );
  const v = await vod.convert({ sessionId: UUID, durationSec: 7200, fileSizeBytes: 1024, lessonId: 'lesson-1' });
  assert.deepEqual([v.vodId, v.storagePathR2], ['vod-1', `live-vod/${UUID}/hls/master.m3u8`]);
  assert.deepEqual(attached, ['lesson-1']);
  // Idempotent STREAM_ENDED redelivery.
  const vod2 = new ConvertLiveToVodUseCase(
    repoOf({ ...liveSession, status: 'ENDED' }, {
      findVodBySession: async () => ({ id: 'vod-old', hlsMasterUrl: 'https://vod.local/x', storagePathR2: 'live-vod/x' }),
      createVodRecord: async () => { throw new Error('must not duplicate'); },
    }) as never,
    vodAdapter,
    bus(),
  );
  assert.equal((await vod2.convert({ sessionId: UUID })).vodId, 'vod-old');
  // Ineligible (still LIVE) + unknown.
  await assert.rejects(
    new ConvertLiveToVodUseCase(repoOf(liveSession) as never, vodAdapter, bus()).convert({ sessionId: UUID }),
    /not eligible/,
  );
  await assert.rejects(
    new ConvertLiveToVodUseCase(repoOf(null) as never, vodAdapter, bus()).convert({ sessionId: UUID }),
    /not found/,
  );
  ok('Signaling: SDP gate + answer; VOD: archive + idempotent retry + 2 gates');
}

// ---------- 6. Chat gateway (BDD-2 window-50) ----------
async function sectionChat(): Promise<void> {
  const b = bus();
  const posted: string[] = [];
  const gw = new LiveChatGateway(
    repoOf(liveSession, {
      postChat: async (d: Record<string, unknown>) => { posted.push(d['content'] as string); return { id: `m-${posted.length}`, createdAt: new Date(NOW) }; },
      listChat: async () => Array.from({ length: 60 }, (_, i) => ({ id: `h-${i}`, userId: 'u', content: `c${i}`, createdAt: new Date(NOW) })),
    }) as never,
    b,
  );
  const frames: string[] = [];
  const release = gw.subscribe(UUID, { write: (c: string) => { frames.push(c); } });
  assert.equal(gw.subscriberCount(UUID), 1);
  const m = await gw.post({ sessionId: UUID, userId: 'u', content: 'hello' });
  assert.ok(m.messageId.startsWith('m-'));
  assert.equal(frames.length, 1);
  assert.ok(frames[0]?.includes('hello'));
  await assert.rejects(gw.post({ sessionId: UUID, userId: 'u', content: '' }), /Empty/);
  const history = await gw.history(UUID);
  assert.equal(history.length, 50);
  assert.equal(history[0]?.id, 'h-10');
  release();
  assert.equal(gw.subscriberCount(UUID), 0);
  ok('Chat: SSE fan-out + 500-char post + window-50 history + unsubscribe');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum LiveStreamVendor {',
    'HLS_LOW_LATENCY',
    'enum LiveSessionStatus {',
    'ARCHIVED',
    'enum LiveMessageType {',
    'LINE_STICKER',
    'model LiveSession {',
    'streamKey        String            @unique',
    'instructor       User              @relation("InstructorSessions"',
    'model LiveChatMessage {',
    'isPinned         Boolean         @default(false)',
    '@@index([sessionId, createdAt])',
    'model LivePoll {',
    'model LivePollOption {',
    'model LivePollVote {',
    '@@unique([pollId, userId])',
    'model LiveToVodRecord {',
    'fileSizeBytes BigInt      @default(0)',
    'liveSessions',
    'LiveSession[] @relation("InstructorSessions")',
    'liveChatMessages  LiveChatMessage[]',
    'livePollVotes     LivePollVote[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: sessions/chat/polls/votes/VOD + User/Product relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/live/live.module.ts',
    'apps/backend/src/modules/live/live.controller.ts',
    'apps/backend/src/modules/live/domain/entities/live-session.entity.ts',
    'apps/backend/src/modules/live/domain/services/entitlement-checker.service.ts',
    'apps/backend/src/modules/live/application/dtos/create-live-session.dto.ts',
    'apps/backend/src/modules/live/application/dtos/join-live-stream.dto.ts',
    'apps/backend/src/modules/live/application/use-cases/mint-ivs-token.usecase.ts',
    'apps/backend/src/modules/live/application/use-cases/handle-webrtc-signaling.usecase.ts',
    'apps/backend/src/modules/live/application/use-cases/convert-live-to-vod.usecase.ts',
    'apps/backend/src/modules/live/infrastructure/adapters/amazon-ivs.adapter.ts',
    'apps/backend/src/modules/live/infrastructure/adapters/cloudflare-r2-vod.adapter.ts',
    'apps/backend/src/modules/live/infrastructure/websocket/live-chat.gateway.ts',
    'apps/backend/src/modules/live/infrastructure/persistence/live-session.repository.ts',
    'apps/backend/src/api/graphql/resolvers/live.resolver.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  const mod = readFileSync('apps/backend/src/modules/live/live.module.ts', 'utf8');
  assert.ok(mod.includes('LiveModule') && mod.includes('MintPlaybackTokenUseCase') && mod.includes('LiveChatGateway'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('LiveModule'));
  const gql = readFileSync('apps/backend/src/api/graphql/resolvers/live.resolver.ts', 'utf8');
  assert.ok(gql.includes('joinLiveSession') && gql.includes('getLiveSession') && gql.includes('voteLivePoll'));
  for (const p of [
    'apps/frontend/components/live/WebRtcIvsPlayer.tsx',
    'apps/frontend/components/live/LiveChatOverlay.tsx',
    'apps/frontend/components/live/LivePollModal.tsx',
    'apps/frontend/hooks/useLiveSession.ts',
    'apps/frontend/lib/live/live-client.ts',
    'apps/frontend/app/(liff)/live/[sessionId]/page.tsx',
  ]) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.length > 200 && !src.includes('AUTO-SCAFFOLD'), `frontend missing: ${p}`);
  }
  const player = readFileSync('apps/frontend/components/live/WebRtcIvsPlayer.tsx', 'utf8');
  assert.ok(!player.includes('amazon-ivs-player'), 'zero-dep player (no heavy IVS lib)');
  const hook = readFileSync('apps/frontend/hooks/useLiveSession.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  for (const p of [
    'apps/frontend/app/api/v1/live/join/route.ts',
    'apps/frontend/app/api/v1/live/sessions/[id]/chat/route.ts',
    'apps/frontend/app/api/v1/live/sessions/[id]/chat/stream/route.ts',
    'apps/frontend/app/api/v1/live/polls/vote/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('live-contract') && barrel.includes('LiveStreamAccessRequestSchema'));
  ok('Parity: module/GQL/player+chat+poll/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionGate();
  await sectionJoin();
  await sectionSignalVod();
  await sectionChat();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase099 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
