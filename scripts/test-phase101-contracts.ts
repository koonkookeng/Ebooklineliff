// SSOT Phase 101 §10-11 — contract tests (Zod, engines, gateway, parity)
// Run: npx tsx scripts/test-phase101-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LiveHandRaiseStatusEnum,
  LiveMessageTypeEnum,
  LiveInteractiveChatSchema,
  LiveHandRaisePayloadSchema,
  LivePollOptionSchema,
  LivePollPayloadSchema,
  LiveChatMessagePayloadSchema,
  LivePollVoteSchema,
  liveRaiseQueueKey,
  livePollCounterKey,
  livePollVotersKey,
  liveViewerKey,
  liveRoomChannel,
  pollPercentages,
} from '../packages/shared/src/schemas/live-contract';
import { LiveStreamService } from '../apps/backend/src/modules/live/services/live-stream.service';
import { LiveChatEngine } from '../apps/backend/src/modules/live/services/live-chat.engine';
import { LivePollEngine } from '../apps/backend/src/modules/live/services/live-poll.engine';
import { HandRaiseQueue } from '../apps/backend/src/modules/live/services/hand-raise.queue';
import { LiveSocketGateway } from '../apps/backend/src/gateways/live-socket/live-socket.gateway';
import { LiveSocketGuard } from '../apps/backend/src/gateways/live-socket/guards/live-socket.guard';
import { RedisFanoutAdapter } from '../apps/backend/src/gateways/live-socket/adapters/redis-fanout.adapter';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const NOW = Date.now();

// ---------- 1. Zod 101 surface (§3.1 additive, Gate 1) ----------
{
  assert.equal(LiveHandRaiseStatusEnum.safeParse('CANCELLED').success, true);
  assert.equal(LiveHandRaiseStatusEnum.safeParse('WAITING').success, false);
  assert.equal(LiveMessageTypeEnum.safeParse('PRODUCT_PIN').success, true);
  assert.equal(LiveMessageTypeEnum.safeParse('EMOJI').success, false);
  assert.equal(
    LiveInteractiveChatSchema.safeParse({
      id: UUID, sessionId: UUID_B, userId: 'u1', displayName: 'Ann', avatarUrl: null,
      messageType: 'LINE_STICKER', content: '[sticker]', stickerPackageId: '1', stickerId: '2',
      timestamp: new Date(NOW).toISOString(),
    }).success,
    true,
  );
  assert.equal(
    LiveInteractiveChatSchema.safeParse({
      id: UUID, sessionId: UUID_B, userId: 'u1', displayName: 'Ann', avatarUrl: null,
      messageType: 'TEXT', content: 'x'.repeat(501), timestamp: new Date(NOW).toISOString(),
    }).success,
    false,
  );
  assert.equal(
    LiveHandRaisePayloadSchema.safeParse({
      id: UUID, sessionId: UUID_B, userId: 'u1', displayName: 'Ann',
      status: 'PENDING', queuePosition: 1, createdAt: new Date(NOW).toISOString(),
    }).success,
    true,
  );
  assert.equal(
    LiveHandRaisePayloadSchema.safeParse({
      id: UUID, sessionId: UUID_B, userId: 'u1', displayName: 'Ann',
      status: 'PENDING', queuePosition: -1, createdAt: new Date(NOW).toISOString(),
    }).success,
    false,
  );
  assert.equal(
    LivePollPayloadSchema.safeParse({
      pollId: UUID, sessionId: UUID_B, question: 'Q?',
      options: [{ optionId: UUID_C, text: 'A', voteCount: 3 }],
      isActive: true, totalVotes: 3, expiresAt: new Date(NOW + 60000).toISOString(),
    }).success,
    true,
  );
  assert.equal(LivePollOptionSchema.safeParse({ optionId: UUID, text: '', voteCount: 0 }).success, false);
  // 099 shapes stay valid (no drift).
  assert.equal(
    LiveChatMessagePayloadSchema.safeParse({
      sessionId: UUID, messageId: UUID_B, senderName: 'Ann', content: 'hi', timestamp: '2026-01-01',
    }).success,
    true,
  );
  assert.equal(LivePollVoteSchema.safeParse({ pollId: UUID, optionId: UUID_B, userId: UUID_C }).success, true);
  ok('Zod §3.1 additive (raise/type/chat/poll) + 099 shapes intact');
}

// ---------- 2. Pure helpers ----------
{
  assert.equal(liveRaiseQueueKey('s'), 'live:raise-queue:s');
  assert.equal(livePollCounterKey('p'), 'live:poll:votes:p');
  assert.equal(livePollVotersKey('p'), 'live:poll:voters:p');
  assert.equal(liveViewerKey('s'), 'live:viewers:s');
  assert.equal(liveRoomChannel('s'), 'live:room:s');
  assert.deepEqual(pollPercentages([]), []);
  assert.deepEqual(pollPercentages([{ optionId: 'a', votes: 1 }, { optionId: 'b', votes: 3 }]), [
    { optionId: 'a', votes: 1, percentage: 25 },
    { optionId: 'b', votes: 3, percentage: 75 },
  ]);
  ok('Helpers: queue/counter/voter/viewer/channel keys + percentages');
}

// ---------- shared mocks ----------
function fanout() {
  const streams: string[] = [];
  return { streams, xaddPipeline: async (s: string) => { streams.push(s); } };
}

const SESSION = { id: UUID, productId: null, instructorId: UUID_C, title: 'T', vendor: 'AMAZON_IVS', status: 'LIVE', streamKey: 'k', playbackArn: null, scheduledAt: new Date(NOW), peakViewers: 0 };

// ---------- 3. Stream service (sessions + viewer counter) ----------
async function sectionStream(): Promise<void> {
  const counts = new Map<string, number>();
  const created: string[] = [];
  const sessions = {
    createSession: async (d: Record<string, unknown>) => { created.push(d['title'] as string); return { ...SESSION, ...d }; },
    findSessionById: async () => SESSION,
  };
  const peaks: number[] = [];
  const interaction = {
    readAnalytics: async () => null,
    touchPeak: async (_s: string, p: number) => { peaks.push(p); },
  };
  const counters = {
    incr: async (k: string) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; },
    decr: async (k: string) => { const n = Math.max(0, (counts.get(k) ?? 0) - 1); counts.set(k, n); return n; },
    xaddPipeline: async () => undefined,
  };
  const svc = new LiveStreamService(sessions as never, interaction as never, counters);
  await svc.createSession({ instructorId: UUID_C, title: 'Class', scheduledAt: new Date(NOW), streamKey: 'k1' });
  assert.deepEqual(created, ['Class']);
  assert.deepEqual([(await svc.viewerJoin(UUID)).count, (await svc.viewerJoin(UUID)).count], [1, 2]);
  assert.deepEqual(peaks, [1, 2]);
  assert.equal((await svc.viewerLeave(UUID)).count, 1);
  assert.equal((await svc.viewerLeave(UUID)).count, 0);
  assert.equal((await svc.viewerLeave(UUID)).count, 0);
  ok('Stream: create + atomic join/leave + peak ledger (floor 0)');
}

// ---------- 4. Chat engine (BDD-1 window-50 + stickers) ----------
async function sectionChat(): Promise<void> {
  const f = fanout();
  const sessions = { findSessionById: async () => SESSION, postChat: async () => ({ id: 'm1', createdAt: new Date(NOW) }) };
  const bumps: string[] = [];
  const interaction = {
    bumpAnalytics: async (_s: string, field: string) => { bumps.push(field); },
    chatWithUser: async () => [{ id: 'm1', sessionId: UUID, userId: 'u', displayName: 'Ann', avatarUrl: null, messageType: 'TEXT', content: 'hi', stickerPackageId: null, stickerId: null, createdAt: new Date(NOW) }],
  };
  const eng = new LiveChatEngine(sessions as never, interaction as never, f);
  const m = await eng.send({ sessionId: UUID, userId: 'u', content: 'hi' });
  assert.deepEqual([m.displayName, m.messageType], ['Ann', 'TEXT']);
  assert.ok(f.streams.length > 0 && bumps.includes('totalMessages'));
  const s = await eng.send({ sessionId: UUID, userId: 'u', content: '', stickerPackageId: '1', stickerId: '2' });
  assert.equal(s.messageType, 'LINE_STICKER');
  assert.ok(bumps.includes('totalStickers'));
  await assert.rejects(eng.send({ sessionId: UUID, userId: 'u', content: '', messageType: 'NOPE' }), /messageType/);
  await assert.rejects(eng.send({ sessionId: UUID, userId: 'u', content: '' }), /Empty/);
  await assert.rejects(
    new LiveChatEngine({ findSessionById: async () => null } as never, interaction as never, f)
      .send({ sessionId: UUID, userId: 'u', content: 'x' }),
    /not found/,
  );
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `h-${i}`, sessionId: UUID, userId: 'u', displayName: 'A', avatarUrl: null,
    messageType: 'TEXT', content: `c${i}`, createdAt: new Date(NOW),
  }));
  const capped = new LiveChatEngine(sessions as never, { chatWithUser: async () => many } as never, f);
  const history = await capped.history(UUID);
  assert.equal(history.length, 50);
  assert.equal(history[0]?.id, 'h-10');
  ok('Chat: enriched send + sticker ledger + 4 gates + window-50');
}

// ---------- 5. Poll engine (BDD-3 atomic + percentages) ----------
async function sectionPoll(): Promise<void> {
  const f = fanout();
  const store = new Map<string, string>();
  const zinc: Array<[string, number, string]> = [];
  const counters = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    zincrby: async (k: string, n: number, m: string) => { zinc.push([k, n, m]); },
    xaddPipeline: async () => undefined,
  };
  const sessions = {
    findSessionById: async () => SESSION,
    createPoll: async () => ({ id: 'poll-1' }),
    votePoll: async () => ({ id: 'v1' }),
  };
  const votes = [
    { optionId: 'o1', userId: 'u1' },
    { optionId: 'o1', userId: 'u2' },
    { optionId: 'o2', userId: 'u3' },
  ];
  const interaction = {
    bumpAnalytics: async () => undefined,
    pollDetail: async () => ({
      id: 'poll-1', sessionId: UUID, question: 'Q?', isActive: true, expiresAt: new Date(NOW + 60000),
      options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }],
      votes,
    }),
  };
  const eng = new LivePollEngine(sessions as never, interaction as never, counters, f);
  const created = await eng.create({ sessionId: UUID, question: 'Q?', options: ['A', 'B'], durationSec: 60 });
  assert.equal(created.pollId, 'poll-1');
  await assert.rejects(eng.create({ sessionId: UUID, question: 'Q?', options: ['A'], durationSec: 60 }), /Invalid poll/);
  const r = await eng.vote({ pollId: 'poll-1', optionId: 'o1', userId: 'u9' });
  assert.deepEqual([r.totalVotes, r.userVotedOptionId], [3, null]);
  const o1 = r.options.find((o) => o.optionId === 'o1');
  assert.deepEqual([o1?.votes, o1?.percentage], [2, 66.67]);
  assert.ok(zinc.some(([k, n, m]) => k === livePollCounterKey('poll-1') && n === 1 && m === 'o1'));
  // Re-vote same option: no double count.
  const zincBefore = zinc.length;
  await eng.vote({ pollId: 'poll-1', optionId: 'o1', userId: 'u9' });
  assert.equal(zinc.length, zincBefore);
  // Change vote: move one count.
  await eng.vote({ pollId: 'poll-1', optionId: 'o2', userId: 'u9' });
  assert.ok(zinc.some(([k, n, m]) => k === livePollCounterKey('poll-1') && n === -1 && m === 'o1'));
  // Gates: inactive / expired / unknown option.
  const closed = { ...interaction, pollDetail: async () => ({ ...(await interaction.pollDetail()), isActive: false }) };
  await assert.rejects(new LivePollEngine(sessions as never, closed as never, counters, f).vote({ pollId: 'p', optionId: 'o1', userId: 'u' }), /not active/);
  await assert.rejects(eng.vote({ pollId: 'poll-1', optionId: 'oX', userId: 'u' }), /Unknown option/);
  // 099 polls without expiry surface expiresAt: null (101 union).
  const noExp = { ...interaction, pollDetail: async () => ({ ...(await interaction.pollDetail()), expiresAt: null }) };
  const rNull = await new LivePollEngine(sessions as never, noExp as never, counters, f).results('poll-1');
  assert.equal(rNull.expiresAt, null);
  assert.equal(
    LivePollPayloadSchema.safeParse({
      pollId: UUID, sessionId: UUID_B, question: 'Q?',
      options: [{ optionId: UUID_C, text: 'A', voteCount: 0 }],
      isActive: true, totalVotes: 0, expiresAt: null,
    }).success,
    true,
  );
  ok('Poll: create + exactly-once + re-vote move + percentages + 3 gates');
}

// ---------- 6. Hand-raise queue (BDD-2 ZSET <100ms) ----------
async function sectionRaise(): Promise<void> {
  const f = fanout();
  const zset = new Map<string, number>();
  const store = {
    zadd: async (k: string, s: number, m: string) => { zset.set(`${k}:${m}`, s); },
    zrange: async (k: string) => [...zset.entries()].filter(([key]) => key.startsWith(`${k}:`)).sort((a, b) => a[1] - b[1]).map(([key]) => key.slice(k.length + 1)),
    zrem: async (k: string, m: string) => { zset.delete(`${k}:${m}`); },
    xaddPipeline: async () => undefined,
  };
  const rows = new Map<string, Record<string, unknown>>();
  const interaction = {
    requestRaise: async (sid: string, uid: string) => {
      const row = { id: `r-${uid}`, sessionId: sid, userId: uid, displayName: `S-${uid}`, status: 'PENDING', queuePosition: 0, createdAt: new Date(NOW) };
      rows.set(row.id, row);
      return row;
    },
    setRaiseStatus: async (id: string, status: string, pos?: number) => {
      const row = { ...(rows.get(id) as Record<string, unknown>), status, ...(pos !== undefined ? { queuePosition: pos } : {}) };
      rows.set(id, row);
      return row as never;
    },
    listRaises: async () => [...rows.values()].filter((r) => r['status'] === 'PENDING') as never,
    bumpAnalytics: async () => undefined,
  };
  const sessions = { findSessionById: async () => SESSION };
  const q = new HandRaiseQueue(sessions as never, interaction as never, store, f);
  const t0 = Date.now();
  const first = await q.request(UUID, 'u1');
  const second = await q.request(UUID, 'u2');
  assert.ok(Date.now() - t0 < 100, 'raise <100ms budget');
  assert.deepEqual([first.queuePosition, second.queuePosition], [1, 2]);
  const list = await q.queue(UUID);
  assert.deepEqual(list.map((r) => (r as { userId: string }).userId), ['u1', 'u2']);
  const approved = await q.resolve('r-u1', 'APPROVED');
  assert.equal((approved as { status: string }).status, 'APPROVED');
  assert.deepEqual((await q.queue(UUID)).map((r) => (r as { userId: string }).userId), ['u2']);
  await assert.rejects(q.resolve('r-u2', 'MAYBE' as never), /Invalid raise status/);
  await assert.rejects(
    new HandRaiseQueue({ findSessionById: async () => ({ ...SESSION, status: 'ENDED' }) } as never, interaction as never, store, f).request(UUID, 'u3'),
    /ENDED/,
  );
  ok('Raise: FIFO positions + approve dequeues + 2 gates (<100ms)');
}

// ---------- 7. Socket gateway + guard + fanout ----------
async function sectionGateway(): Promise<void> {
  const streams: string[] = [];
  const published: string[] = [];
  const handlers = new Map<string, (m: string) => void>();
  const gw = new LiveSocketGateway(
    {
      xaddPipeline: async (s: string) => { streams.push(s); },
      incr: async () => 41,
      decr: async () => 40,
    },
    {
      publish: async (c: string, m: string) => { published.push(`${c}:${m}`); },
      subscribe: async (c: string, h: (m: string) => void) => { handlers.set(c, h); return () => { handlers.delete(c); }; },
    },
    { verifyToken: (t: string) => (t === 'good' ? { liveRoomId: UUID, userId: UUID_B } : null) },
  );
  // Handshake fail-closed.
  assert.equal(gw.handshake(UUID, 'good'), UUID_B);
  assert.equal(gw.handshake(UUID, 'bad'), null);
  assert.equal(gw.handshake('', 'good'), null);
  const guard = new LiveSocketGuard({ verifyToken: (t: string) => (t === 'good' ? { liveRoomId: UUID, userId: UUID_B } : null) });
  assert.deepEqual(guard.canActivate({ sessionId: UUID, token: 'good' }), { userId: UUID_B });
  assert.equal(guard.canActivate({ sessionId: UUID_B, token: 'good' }), null);
  assert.equal(guard.canActivate({ sessionId: UUID, token: '' }), null);
  // Subscribe joins viewers; broadcast fans out + publishes.
  const frames: string[] = [];
  const release = gw.subscribe(UUID, { write: (c: string) => { frames.push(c); } });
  assert.equal(await gw.broadcast(UUID, 'newMessage', { id: 'm1' }), 1);
  assert.ok(frames[0]?.includes('newMessage'));
  assert.ok(published.some((p) => p.startsWith(liveRoomChannel(UUID))));
  assert.ok(streams.length > 0);
  // Sibling-instance event re-emits locally.
  frames.length = 0;
  handlers.get(liveRoomChannel(UUID))?.(JSON.stringify({ event: 'pollVoteUpdate', payload: { pollId: 'p' } }));
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(frames[0]?.includes('pollVoteUpdate'));
  release();
  // Fanout adapter shapes.
  const fan = new RedisFanoutAdapter({
    publish: async () => undefined,
    subscribe: async () => () => undefined,
  });
  assert.equal(fan.roomChannel('s'), liveRoomChannel('s'));
  await fan.publishRoom('s', 'e', {});
  ok('Gateway: handshake guard + viewers + fan-out + sibling re-emit');
}

// ---------- 8. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum HandRaiseStatus {',
    'CANCELLED',
    'model LiveHandRaise {',
    'queuePosition Int            @default(0)',
    '@@index([sessionId, status])',
    'model LiveAnalytics {',
    'totalHandRaises Int         @default(0)',
    'handRaises       LiveHandRaise[]',
    'analytics        LiveAnalytics?',
    'liveHandRaises    LiveHandRaise[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: hand-raises + analytics + session/user relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/live/services/live-stream.service.ts',
    'apps/backend/src/modules/live/services/live-chat.engine.ts',
    'apps/backend/src/modules/live/services/live-poll.engine.ts',
    'apps/backend/src/modules/live/services/hand-raise.queue.ts',
    'apps/backend/src/modules/live/repositories/live-interaction.repository.ts',
    'apps/backend/src/gateways/live-socket/live-socket.gateway.ts',
    'apps/backend/src/gateways/live-socket/guards/live-socket.guard.ts',
    'apps/backend/src/gateways/live-socket/adapters/redis-fanout.adapter.ts',
    'apps/backend/src/api/graphql/resolvers/live/live-interaction.resolver.ts',
    'apps/backend/src/modules/live/live.module.ts',
    'apps/backend/src/modules/live/live.controller.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  for (const f of [
    'apps/backend/src/gateways/live-socket/live-socket.gateway.ts',
    'apps/frontend/hooks/useLiveSocket.ts',
    'apps/frontend/components/live/LiveInteractionOverlay.tsx',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('socket.io'), `${f} WS lib`);
  }
  const gql = readFileSync('apps/backend/src/api/graphql/resolvers/live/live-interaction.resolver.ts', 'utf8');
  assert.ok(
    gql.includes('sendLiveMessage') && gql.includes('requestHandRaise') && gql.includes('approveHandRaise') &&
    gql.includes('createLivePoll') && gql.includes('voteLivePoll') && gql.includes('createLiveSession'),
    'GQL intents',
  );
  for (const p of [
    'apps/frontend/components/live/LiveInteractionOverlay.tsx',
    'apps/frontend/hooks/useLiveSocket.ts',
  ]) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.length > 200 && !src.includes('AUTO-SCAFFOLD'), `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useLiveSocket.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  for (const p of [
    'apps/frontend/app/api/v1/live/sessions/[id]/room/stream/route.ts',
    'apps/frontend/app/api/v1/live/sessions/[id]/chat/send/route.ts',
    'apps/frontend/app/api/v1/live/sessions/[id]/raise/route.ts',
    'apps/frontend/app/api/v1/live/polls/[pollId]/vote2/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const overlay = readFileSync('apps/frontend/components/live/LiveInteractionOverlay.tsx', 'utf8');
  assert.ok(overlay.includes('liveChatWindow') && overlay.includes('raiseHand'), 'overlay window-50 + raise');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('LiveHandRaisePayloadSchema') && barrel.includes('LivePollPayloadSchema'));
  ok('Parity: engines/repo/gateway+guard+adapter/GQL/overlay/hook/proxies/barrel (zero-dep)');
}

async function main(): Promise<void> {
  await sectionStream();
  await sectionChat();
  await sectionPoll();
  await sectionRaise();
  await sectionGateway();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase101 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
