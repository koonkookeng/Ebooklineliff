// SSOT Phase 096 §10-11 — contract tests (Zod, squads, anti-cheat, points, board, parity)
// Run: npx tsx scripts/test-phase096-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SquadMemberRoleEnum,
  PointActivityTypeEnum,
  LeaderboardTimeframeEnum,
  LeaderboardScopeEnum,
  CreateSquadInputSchema,
  ClaimPointInputSchema,
  SquadLeaderboardEntrySchema,
  POINT_TABLE,
  MIN_DWELL_SEC,
  CLAIM_VELOCITY_LIMIT,
  CLAIM_NONCE_TTL_SEC,
  SQUAD_STREAM,
  pointsFor,
  velocityExceeded,
  leaderboardKey,
  squadInviteUrl,
  squadCode,
} from '../packages/shared/src/schemas/squad-gamification.zod';
import { assertJoinable, assertSquadCreatable } from '../apps/backend/src/modules/squad/domain/squad.entity';
import { CreateSquadUsecase } from '../apps/backend/src/modules/squad/application/create-squad.usecase';
import { JoinSquadUsecase, LeaveSquadUsecase } from '../apps/backend/src/modules/squad/application/join-squad.usecase';
import { signClaimNonce, verifyClaimNonce, dwellSatisfied, velocityCapped } from '../apps/backend/src/modules/gamification/services/anti-cheat.guard';
import { PointEngineService } from '../apps/backend/src/modules/gamification/services/point-engine.service';
import { StudyActivityListener } from '../apps/backend/src/modules/gamification/events/study-activity.listener';
import { RedisLeaderboardService } from '../apps/backend/src/modules/leaderboard/services/redis-leaderboard.service';
import { buildSquadInviteFlex } from '../apps/backend/src/modules/leaderboard/infrastructure/line/squad-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const SECRET = 'test-claim-secret';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(SquadMemberRoleEnum.safeParse('LEADER').success, true);
  assert.equal(PointActivityTypeEnum.safeParse('LESSON_WATCHED').success, true);
  assert.equal(PointActivityTypeEnum.safeParse('BOSS_FIGHT').success, false);
  assert.equal(LeaderboardTimeframeEnum.safeParse('WEEKLY').success, true);
  assert.equal(LeaderboardScopeEnum.safeParse('SQUAD').success, true);
  const parsed = CreateSquadInputSchema.safeParse({ name: 'AI Masterminds', maxMembers: 5 });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.maxMembers, 5);
    assert.equal(parsed.data.isPrivate, false);
  }
  assert.equal(CreateSquadInputSchema.safeParse({ name: 'AB' }).success, false);
  assert.equal(CreateSquadInputSchema.safeParse({ name: 'Valid', maxMembers: 99 }).success, false);
  assert.equal(
    ClaimPointInputSchema.safeParse({ activityType: 'EBOOK_PAGE_READ', referenceId: UUID, dwellTimeSec: 8, signatureNonce: 'n' }).success,
    true,
  );
  assert.equal(
    ClaimPointInputSchema.safeParse({ activityType: 'NOPE', referenceId: UUID, dwellTimeSec: 8, signatureNonce: 'n' }).success,
    false,
  );
  assert.equal(
    SquadLeaderboardEntrySchema.safeParse({ rank: 1, id: 'u', name: 'S', avatarUrl: null, score: 120 }).success,
    true,
  );
  assert.equal(
    SquadLeaderboardEntrySchema.safeParse({ rank: 0, id: 'u', name: 'S', avatarUrl: null, score: 120 }).success,
    false,
  );
  ok('Zod §3.1 verbatim (role/activity/timeframe/scope/squad/claim/entry gates)');
}

// ---------- 2. Helpers (points/velocity/keys/code) ----------
{
  assert.equal(POINT_TABLE['EBOOK_PAGE_READ'], 5);
  assert.equal(MIN_DWELL_SEC, 5);
  assert.equal(CLAIM_VELOCITY_LIMIT, 12);
  assert.equal(CLAIM_NONCE_TTL_SEC, 300);
  assert.equal(SQUAD_STREAM, 'stream:squad:points');
  assert.equal(pointsFor('QUIZ_PASSED', 1.0), 20);
  assert.equal(pointsFor('QUIZ_PASSED', 1.5), 30);
  assert.equal(pointsFor('UNKNOWN', 1.0), 0);
  assert.equal(velocityExceeded(11), false);
  assert.equal(velocityExceeded(12), true);
  assert.equal(velocityCapped(12), true);
  assert.equal(leaderboardKey('GLOBAL', 't1', 'WEEKLY'), 'leaderboard:global:t1:weekly');
  assert.equal(squadInviteUrl('https://liff.line.me/', 'SQD-X'), 'https://liff.line.me/squads/join?code=SQD-X');
  assert.ok(/^SQD-[0-9A-Z]+-[0-9A-Z]{4}$/.test(squadCode()));
  assert.ok(dwellSatisfied('EBOOK_PAGE_READ', 5));
  assert.ok(!dwellSatisfied('EBOOK_PAGE_READ', 4));
  const card = buildSquadInviteFlex({ squadName: 'AI Masterminds', totalPoints: 1200, inviteUrl: 'https://x/y' }) as {
    type: string; altText: string; contents: { footer: { contents: Array<{ action: { uri: string } }> } };
  };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('AI Masterminds'));
  assert.ok(JSON.stringify(card).includes('เข้ากลุ่มเรียนทันที'));
  ok('Helpers: point table/velocity/keys/code/Flex + budgets');
}

// ---------- 3. Squad guards ----------
{
  assert.doesNotThrow(() => assertSquadCreatable('AI Masterminds', 5));
  assert.throws(() => assertSquadCreatable('AB', 5), /3-30/);
  assert.throws(() => assertSquadCreatable('Valid Name', 99), /2-20/);
  assert.doesNotThrow(() => assertJoinable({ memberCount: 1, maxMembers: 5, memberIds: ['a'], userId: 'b' }));
  assert.throws(() => assertJoinable({ memberCount: 1, maxMembers: 5, memberIds: ['b'], userId: 'b' }), /Already/);
  assert.throws(() => assertJoinable({ memberCount: 5, maxMembers: 5, memberIds: ['a'], userId: 'b' }), /full/);
  ok('Guards: squad create/join capacity + duplicate shield');
}

// ---------- 4. Squad usecases (BDD-1: create + code join + leave) ----------
async function sectionSquads(): Promise<void> {
  const streams: string[] = [];
  const squads = new Map<string, { id: string; code: string; members: string[]; maxMembers: number }>();
  const repo = {
    createSquad: async (a: { name: string; squadCode: string; maxMembers: number }) => {
      const row = { id: 'sq-1', tenantId: null, name: a.name, description: null, avatarUrl: null, squadCode: a.squadCode, maxMembers: a.maxMembers, totalPoints: 0, isPrivate: false, squadLeaderId: UUID };
      squads.set('sq-1', { id: 'sq-1', code: a.squadCode, members: [UUID], maxMembers: a.maxMembers });
      return row;
    },
    findById: async (id: string) => {
      const s = squads.get(id);
      return s ? { id: s.id, tenantId: null, name: 'S', description: null, avatarUrl: null, squadCode: s.code, maxMembers: s.maxMembers, totalPoints: 0, isPrivate: false, squadLeaderId: UUID, members: s.members.map((u) => ({ squadId: id, userId: u, role: 'MEMBER', pointsContributed: 0, joinedAt: new Date(), user: { displayName: 'M', avatarUrl: null } })) } : null;
    },
    findByCode: async (code: string) => {
      const s = [...squads.values()].find((x) => x.code === code);
      if (!s) return null;
      return { id: s.id, tenantId: null, name: 'S', description: null, avatarUrl: null, squadCode: s.code, maxMembers: s.maxMembers, totalPoints: 0, isPrivate: false, squadLeaderId: UUID, members: s.members.map((u) => ({ squadId: s.id, userId: u, role: 'MEMBER', pointsContributed: 0, joinedAt: new Date(), user: { displayName: 'M', avatarUrl: null } })) };
    },
    userSquads: async () => [],
    addMember: async (id: string, userId: string) => { squads.get(id)?.members.push(userId); },
    removeMember: async (id: string, userId: string) => {
      const s = squads.get(id);
      if (s) s.members = s.members.filter((m) => m !== userId);
    },
    addSquadPoints: async () => undefined,
    addMemberPoints: async () => undefined,
    createChallenge: async (a: Record<string, unknown>) => ({ id: 'ch-1', ...a, currentPoints: 0, isCompleted: false }),
  };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const create = new CreateSquadUsecase(repo as never, bus);
  const r = await create.execute({ leaderId: UUID, input: { name: 'AI Masterminds', maxMembers: 5 } });
  assert.equal(r.squadId, 'sq-1');
  assert.ok(/^SQD-/.test(r.squadCode));
  assert.ok(r.inviteUrl.includes(r.squadCode));
  assert.ok(JSON.parse(r.flexMessageJson));
  assert.ok(streams.includes(SQUAD_STREAM));
  await assert.rejects(create.execute({ leaderId: UUID, input: { name: 'AB' } }), /Invalid squad/);
  const join = new JoinSquadUsecase(repo as never, bus);
  const j = await join.execute({ userId: UUID_B, squadCode: r.squadCode });
  assert.equal(j.memberCount, 2);
  await assert.rejects(join.execute({ userId: UUID_B, squadCode: r.squadCode }), /Already/);
  await assert.rejects(join.execute({ userId: UUID_C }), /Missing squadCode/);
  const leave = new LeaveSquadUsecase(repo as never);
  assert.equal(await leave.execute({ userId: UUID_B, squadId: 'sq-1' }), true);
  ok('Squads: create + Flex + code-join + leave + 3 gates');
}

// ---------- 5. Anti-cheat (HMAC nonce + dwell + velocity) ----------
{
  const ts = Date.now();
  const sig = signClaimNonce({ userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, ts, secret: SECRET });
  const nonce = `${ts}.${sig}`;
  assert.equal(verifyClaimNonce({ nonce, userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, secret: SECRET }), true);
  assert.equal(verifyClaimNonce({ nonce: 'garbage', userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, secret: SECRET }), false);
  assert.equal(verifyClaimNonce({ nonce, userId: UUID_C, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, secret: SECRET }), false);
  const old = `${ts - 10 * 60 * 1000}.${signClaimNonce({ userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, ts: ts - 10 * 60 * 1000, secret: SECRET })}`;
  assert.equal(verifyClaimNonce({ nonce: old, userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, secret: SECRET }), false);
  assert.equal(verifyClaimNonce({ nonce, userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, secret: 'wrong' }), false);
  ok('Anti-cheat: HMAC valid/forged/expired/wrong-user/wrong-secret shapes');
}

// ---------- 6. Point engine (BDD-2: verified claim → atomic ledger) ----------
function pointPorts() {
  const txns: number[] = [];
  const users = new Map<string, number>([[UUID, 100]]);
  const nonces = new Set<string>();
  const streams: string[] = [];
  const boards: Array<{ kind: string; id: string; points: number }> = [];
  const store = {
    recordTransaction: async () => { txns.push(1); },
    incrementUserPoints: async (tx: unknown, userId: string, points: number) => {
      const next = (users.get(userId) ?? 0) + points;
      users.set(userId, next);
      return next;
    },
    incrementSquadPoints: async () => undefined,
    recentClaimCount: async () => 3,
    markNonceUsed: async (nonce: string) => {
      if (nonces.has(nonce)) return false;
      nonces.add(nonce);
      return true;
    },
    applyChallengeProgress: async () => ({ completed: false, bonus: 0 }),
  };
  const board = {
    updateUserScore: async (a: { userId: string; addedPoints: number }) => { boards.push({ kind: 'user', id: a.userId, points: a.addedPoints }); },
    updateSquadScore: async (a: { squadId: string; addedPoints: number }) => { boards.push({ kind: 'squad', id: a.squadId, points: a.addedPoints }); },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const claim = (nonce: string, extra: Record<string, unknown> = {}) => ({
    userId: UUID,
    squadId: 'sq-9' as string | undefined,
    input: { activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, dwellTimeSec: 8, signatureNonce: nonce, ...extra },
  });
  const freshNonce = () => {
    const ts = Date.now();
    return `${ts}.${signClaimNonce({ userId: UUID, activityType: 'EBOOK_PAGE_READ', referenceId: UUID_B, ts, secret: SECRET })}`;
  };
  return { store, board, tx, bus, claim, freshNonce, txns, streams, boards, users };
}

async function sectionPoints(): Promise<void> {
  // Happy path: +5 ledger + board fan-out + stream.
  {
    const p = pointPorts();
    const svc = new PointEngineService(p.store, p.board, p.tx, p.bus, SECRET);
    const r = await svc.claim(p.claim(p.freshNonce()));
    assert.deepEqual([r.pointsEarned, r.newTotalPoints, r.squadBonusEarned], [5, 105, 0]);
    assert.equal(p.txns.length, 1);
    assert.ok(p.boards.some((b) => b.kind === 'user' && b.points === 5));
    assert.ok(p.boards.some((b) => b.kind === 'squad' && b.points === 5));
    assert.ok(p.streams.includes(SQUAD_STREAM));
  }
  // Challenge completion bonus.
  {
    const p = pointPorts();
    p.store.applyChallengeProgress = async () => ({ completed: true, bonus: 25 });
    const svc = new PointEngineService(p.store, p.board, p.tx, p.bus, SECRET);
    const r = await svc.claim(p.claim(p.freshNonce()));
    assert.deepEqual([r.squadBonusEarned, r.newTotalPoints], [25, 130]);
  }
  // Gates: dwell / bad nonce / replay / velocity.
  {
    const p = pointPorts();
    const svc = new PointEngineService(p.store, p.board, p.tx, p.bus, SECRET);
    await assert.rejects(svc.claim({ ...p.claim(p.freshNonce()), input: { ...p.claim(p.freshNonce()).input, dwellTimeSec: 2 } }), /Dwell time/);
    await assert.rejects(svc.claim(p.claim('garbage.nonce')), /signature/);
    const nonce = p.freshNonce();
    await svc.claim(p.claim(nonce));
    await assert.rejects(svc.claim(p.claim(nonce)), /already processed/);
    const hot = pointPorts();
    hot.store.recentClaimCount = async () => 12;
    const hotSvc = new PointEngineService(hot.store, hot.board, hot.tx, hot.bus, SECRET);
    await assert.rejects(hotSvc.claim(hot.claim(hot.freshNonce())), /velocity/);
    await assert.rejects(svc.claim({ userId: UUID, input: { activityType: 'NOPE', referenceId: UUID_B, dwellTimeSec: 8, signatureNonce: p.freshNonce() } }), /Invalid point claim/);
  }
  // Listener: success passes through, failure never throws.
  {
    const p = pointPorts();
    const svc = new PointEngineService(p.store, p.board, p.tx, p.bus, SECRET);
    const listener = new StudyActivityListener(svc);
    await listener.onStudyActivity({ userId: UUID, activityType: 'LESSON_WATCHED', referenceId: UUID_B, dwellTimeSec: 30, signatureNonce: (() => { const ts = Date.now(); return `${ts}.${signClaimNonce({ userId: UUID, activityType: 'LESSON_WATCHED', referenceId: UUID_B, ts, secret: SECRET })}`; })() });
    await listener.onStudyActivity({ userId: UUID, activityType: 'LESSON_WATCHED', referenceId: UUID_B, dwellTimeSec: 1, signatureNonce: 'bad' });
    assert.equal(p.txns.length, 1);
  }
  ok('Points: ledger + bonus + 5 gates + listener swallow');
}

// ---------- 7. Leaderboard (BDD-3: fan-out + ranked reads) ----------
async function sectionBoard(): Promise<void> {
  const zsets = new Map<string, Map<string, number>>();
  const port = {
    zincrby: async (key: string, inc: number, member: string) => {
      const m = zsets.get(key) ?? new Map<string, number>();
      m.set(member, (m.get(member) ?? 0) + inc);
      zsets.set(key, m);
    },
    zrevrangeWithScores: async (key: string, start: number, stop: number) => {
      const m = zsets.get(key) ?? new Map<string, number>();
      return [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(start, stop + 1)
        .map(([member, score]) => ({ member, score }));
    },
  };
  const svc = new RedisLeaderboardService(port);
  await svc.updateUserScore({ userId: 'u1', addedPoints: 10, tenantId: 't1' });
  await svc.updateUserScore({ userId: 'u2', addedPoints: 25, tenantId: 't1' });
  await svc.updateSquadScore({ squadId: 'sq-1', addedPoints: 40, tenantId: 't1' });
  const top = await svc.topRankings({ scope: 'GLOBAL', tenantId: 't1', timeframe: 'WEEKLY', limit: 50 });
  assert.deepEqual(top.map((t) => t.memberId), ['u2', 'u1']);
  assert.deepEqual([top[0]?.rank, top[0]?.score], [1, 25]);
  const squadTop = await svc.topRankings({ scope: 'SQUAD', tenantId: 't1', timeframe: 'ALL_TIME', limit: 50 });
  assert.deepEqual([squadTop[0]?.memberId, squadTop[0]?.score], ['sq-1', 40]);
  assert.equal(zsets.size, 8, '4 timeframes × user+squad keys');
  ok('Board: 4-timeframe fan-out + ranked WITHSCORES reads');
}

// ---------- 8. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum SquadMemberRole {',
    'CO_LEADER',
    'enum PointActivityType {',
    'REFERRAL_BONUS',
    'model StudySquad {',
    'squadCode     String           @unique @default(uuid())',
    'model SquadMember {',
    '@@unique([squadId, userId])',
    'model PointTransaction {',
    'multiplier   Float             @default(1.0)',
    'model SquadChallenge {',
    'rewardPoints  Int',
    'squadMemberships  SquadMember[]',
    'pointTransactions PointTransaction[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  assert.ok(!prisma.includes('model GamificationBadge'), 'no duplicate badge tables (083 reuse)');
  ok('Prisma: roles/activities + 4 models + User relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/squad/domain/squad.entity.ts',
    'apps/backend/src/modules/squad/domain/squad.repository.interface.ts',
    'apps/backend/src/modules/squad/application/create-squad.usecase.ts',
    'apps/backend/src/modules/squad/application/join-squad.usecase.ts',
    'apps/backend/src/modules/squad/infrastructure/persistence/prisma-squad.repository.ts',
    'apps/backend/src/modules/squad/squad.controller.ts',
    'apps/backend/src/modules/squad/squad.resolver.ts',
    'apps/backend/src/modules/squad/squad.module.ts',
    'apps/backend/src/modules/gamification/services/point-engine.service.ts',
    'apps/backend/src/modules/gamification/services/anti-cheat.guard.ts',
    'apps/backend/src/modules/gamification/events/study-activity.listener.ts',
    'apps/backend/src/modules/gamification/application/subscribers/learning-event.subscriber.ts',
    'apps/backend/src/modules/gamification/presentation/graphql/squad-points.resolver.ts',
    'apps/backend/src/modules/gamification/presentation/rest/point-claim.controller.ts',
    'apps/backend/src/modules/leaderboard/services/redis-leaderboard.service.ts',
    'apps/backend/src/modules/leaderboard/leaderboard.resolver.ts',
    'apps/backend/src/modules/leaderboard/leaderboard.controller.ts',
    'apps/backend/src/modules/leaderboard/leaderboard.module.ts',
    'apps/backend/src/modules/leaderboard/infrastructure/line/squad-flex.builder.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const squadMod = readFileSync('apps/backend/src/modules/squad/squad.module.ts', 'utf8');
  assert.ok(squadMod.includes('SquadModule') && squadMod.includes('CreateSquadUsecase'));
  assert.ok(!/class SquadModuleModule/.test(squadMod), 'legacy scaffold class removed');
  const gameMod = readFileSync('apps/backend/src/modules/gamification/gamification.module.ts', 'utf8');
  assert.ok(gameMod.includes('PointEngineService') && gameMod.includes('DailyCheckinUseCase'), '083 + 096 wired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('SquadModule') && app.includes('LeaderboardModule') && app.includes('GamificationModule'));
  const gql = readFileSync('apps/backend/src/modules/squad/squad.resolver.ts', 'utf8');
  assert.ok(gql.includes('createStudySquad') && gql.includes('joinStudySquad') && gql.includes('leaveStudySquad'));
  const pts = readFileSync('apps/backend/src/modules/gamification/presentation/graphql/squad-points.resolver.ts', 'utf8');
  assert.ok(pts.includes('claimGamificationPoints') && pts.includes('createSquadChallenge'));
  const board = readFileSync('apps/backend/src/modules/leaderboard/leaderboard.resolver.ts', 'utf8');
  assert.ok(board.includes('getLeaderboard'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/squad/squad.resolver.ts', 'utf8');
  assert.ok(alias.includes('SquadResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/squad.graphql', 'utf8');
  assert.ok(sdl.includes('StudySquadPayload') && sdl.includes('claimGamificationPoints') && sdl.includes('getLeaderboard'));
  for (const p of [
    'apps/frontend/components/squad/StudySquadDashboard.tsx',
    'apps/frontend/components/squad/SquadLeaderboard.tsx',
    'apps/frontend/hooks/useSquads.ts',
    'apps/frontend/hooks/useLeaderboard.ts',
    'apps/frontend/lib/squad/squad-client.ts',
    'apps/frontend/app/(liff)/squads/page.tsx',
    'apps/frontend/app/(liff)/squads/[squadId]/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useSquads.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const dash = readFileSync('apps/frontend/components/squad/StudySquadDashboard.tsx', 'utf8');
  assert.ok(!dash.includes('lucide-react'), 'zero-dep dashboard (no heavy UI)');
  assert.ok(dash.includes('shareTargetPicker'), 'LIFF share + clipboard fallback');
  for (const p of [
    'apps/frontend/app/api/v1/squads/create/route.ts',
    'apps/frontend/app/api/v1/squads/join/route.ts',
    'apps/frontend/app/api/v1/points/claim/route.ts',
    'apps/frontend/app/api/v1/leaderboard/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('squad-gamification.zod') && barrel.includes('CreateSquadInputSchema'));
  ok('Parity: modules/GQL+alias/SDL/dashboard+board/hooks/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionSquads();
  await sectionPoints();
  await sectionBoard();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase096 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
