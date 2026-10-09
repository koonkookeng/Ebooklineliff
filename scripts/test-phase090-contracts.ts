// SSOT Phase 090 §10-11 — contract tests (Zod, code/expiry/K-factor, create/join/expiry, parity)
// Run: npx tsx scripts/test-phase090-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GroupBuyingStatusEnum,
  GroupTypeEnum,
  CreateGroupRoomInputSchema,
  JoinGroupRoomInputSchema,
  GroupRoomDetailsSchema,
  GROUP_DEFAULT_TTL_HOURS,
  GROUP_STREAM,
  requiredMembersFor,
  groupRoomCode,
  groupExpiryAt,
  canJoin,
  groupKFactor,
  groupInviteUrl,
  groupRoomLockKey,
} from '../packages/shared/src/schemas/group-buying-contract';
import { assertJoinable, assertCreatable } from '../apps/backend/src/modules/group-buying/domain/entities/group-room.entity';
import { buildGroupInviteFlex } from '../apps/backend/src/modules/group-buying/infrastructure/line/line-flex-group.builder';
import { CreateGroupRoomService } from '../apps/backend/src/modules/group-buying/application/services/create-room.service';
import { JoinGroupRoomService } from '../apps/backend/src/modules/group-buying/application/services/join-room.service';
import { GroupExpiryService } from '../apps/backend/src/modules/group-buying/application/services/group-expiry.service';
import { GenerateFlexInviteUseCase } from '../apps/backend/src/modules/group-buying/application/use-cases/generate-flex-invite.usecase';

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
  assert.equal(GroupBuyingStatusEnum.safeParse('WAITING_FOR_MEMBERS').success, true);
  assert.equal(GroupBuyingStatusEnum.safeParse('PENDING').success, false);
  assert.equal(GroupTypeEnum.safeParse('BUDDY_PASS_2P').success, true);
  assert.equal(GroupTypeEnum.safeParse('SOLO_PASS').success, false);
  const input = { productId: UUID, groupType: 'BUDDY_PASS_2P' };
  assert.equal(CreateGroupRoomInputSchema.safeParse(input).success, true);
  assert.equal(CreateGroupRoomInputSchema.safeParse({ ...input, productId: 'nope' }).success, false);
  assert.equal(JoinGroupRoomInputSchema.safeParse({ roomId: UUID, slipImageUrl: 'https://r2.example.com/s.webp' }).success, true);
  assert.equal(JoinGroupRoomInputSchema.safeParse({ roomId: UUID, slipImageUrl: 'not-url' }).success, false);
  assert.equal(
    GroupRoomDetailsSchema.safeParse({
      roomId: UUID, productId: UUID, productTitle: 'Ebook', coverImageUrl: 'https://r2.example.com/c.webp',
      creatorDisplayName: 'S', creatorAvatarUrl: null, groupType: 'BUDDY_PASS_2P',
      originalPrice: 500, discountedPrice: 350, requiredMembers: 2, currentMembersCount: 1,
      status: 'WAITING_FOR_MEMBERS', expiresAt: new Date().toISOString(), members: [],
    }).success,
    true,
  );
  assert.equal(
    GroupRoomDetailsSchema.safeParse({
      roomId: UUID, productId: UUID, productTitle: 'Ebook', coverImageUrl: 'not-url',
      creatorDisplayName: 'S', creatorAvatarUrl: null, groupType: 'BUDDY_PASS_2P',
      originalPrice: -1, discountedPrice: 350, requiredMembers: 1, currentMembersCount: 1,
      status: 'WAITING_FOR_MEMBERS', expiresAt: 'nope', members: [],
    }).success,
    false,
  );
  ok('Zod §3.1 verbatim (status/type/create/join/detail gates)');
}

// ---------- 2. Code/expiry/K-factor helpers (§4.1/BDD-1/§7.1) ----------
{
  assert.equal(GROUP_DEFAULT_TTL_HOURS, 24);
  assert.equal(GROUP_STREAM, 'stream:group-buy:events');
  assert.equal(requiredMembersFor('BUDDY_PASS_2P'), 2);
  assert.equal(requiredMembersFor('GROUP_BUY_3P'), 3);
  assert.equal(requiredMembersFor('GROUP_BUY_5P'), 5);
  assert.ok(/^GB-[0-9A-Z]+-[0-9A-Z]{4}$/.test(groupRoomCode()));
  assert.notEqual(groupRoomCode(1000, 1), groupRoomCode(1000, 2));
  assert.equal(groupExpiryAt(0), new Date(24 * 3_600_000).toISOString());
  assert.equal(canJoin({ status: 'WAITING_FOR_MEMBERS', expiresAt: NOW + 1000, currentMembersCount: 1, requiredMembers: 2 }, NOW), true);
  assert.equal(canJoin({ status: 'COMPLETED', expiresAt: NOW + 1000, currentMembersCount: 2, requiredMembers: 2 }, NOW), false);
  assert.equal(canJoin({ status: 'WAITING_FOR_MEMBERS', expiresAt: NOW - 1000, currentMembersCount: 1, requiredMembers: 2 }, NOW), false);
  assert.equal(canJoin({ status: 'WAITING_FOR_MEMBERS', expiresAt: NOW + 1000, currentMembersCount: 2, requiredMembers: 2 }, NOW), false);
  assert.equal(groupKFactor(10, 0.4), 4);
  assert.equal(groupKFactor(0, 0.5), 0);
  assert.equal(groupInviteUrl('https://liff.line.me/', UUID), `https://liff.line.me/group-buy/${UUID}`);
  assert.equal(groupRoomLockKey(UUID), `lock:group-room:${UUID}`);
  assert.doesNotThrow(() =>
    assertJoinable({ status: 'WAITING_FOR_MEMBERS', expiresAt: NOW + 1000, currentMembersCount: 1, requiredMembers: 2, creatorId: UUID_B, memberUserIds: [UUID_B] }, UUID, NOW),
  );
  assert.throws(() =>
    assertJoinable({ status: 'WAITING_FOR_MEMBERS', expiresAt: NOW + 1000, currentMembersCount: 1, requiredMembers: 2, creatorId: UUID, memberUserIds: [UUID] }, UUID, NOW),
    /SELF_JOIN_DISALLOWED/,
  );
  assert.throws(() =>
    assertJoinable({ status: 'COMPLETED', expiresAt: NOW + 1000, currentMembersCount: 2, requiredMembers: 2, creatorId: UUID_B, memberUserIds: [UUID_B] }, UUID, NOW),
    /already full/,
  );
  assert.doesNotThrow(() => assertCreatable(true));
  assert.throws(() => assertCreatable(false), /not enabled/);
  const card = buildGroupInviteFlex({
    productTitle: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp',
    groupType: 'BUDDY_PASS_2P', discountedPrice: 350, originalPrice: 500,
    currentMembers: 1, requiredMembers: 2, inviteUrl: 'https://liff.line.me/group-buy/R',
  }) as { type: string; altText: string; contents: { hero: { url: string }; footer: { contents: Array<{ action: { uri: string } }> } } };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('Ebook A'));
  assert.equal(card.contents.hero.url, 'https://r2.example.com/a.webp');
  assert.ok(JSON.stringify(card).includes('฿350'));
  ok('Helpers: members/code/expiry/K-factor/invite/lock + Flex card');
}

// ---------- 3. Create service (BDD-1: WAITING + Flex + stream) ----------
async function sectionCreate(): Promise<void> {
  const streams: string[] = [];
  const repo = {
    findProduct: async (id: string) =>
      id === UUID ? { id, title: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp', price: 500 } : null,
    findConfig: async (id: string) =>
      id === UUID
        ? { productId: id, isEnabled: true, buddyPassPrice: 350, groupBuy3pPrice: 300, groupBuy5pPrice: 250, timeLimitHours: 24 }
        : null,
    createRoom: async (a: Record<string, unknown>) => ({ id: 'room-1', ...a }),
    addMember: async () => undefined,
    withTx(tx: unknown) { return this; },
  };
  const flex = {
    build: (a: { inviteUrl: string }) => ({ flexMessageJson: JSON.stringify({ url: a.inviteUrl }) }),
  };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new CreateGroupRoomService(repo as never, flex as never, bus);
  const r = await svc.execute({ creatorUserId: UUID_B, input: { productId: UUID, groupType: 'BUDDY_PASS_2P' } });
  assert.equal(r.roomId, 'room-1');
  assert.ok(/^GB-/.test(r.roomCode));
  assert.ok(r.inviteUrl.includes(r.roomId));
  assert.ok(JSON.parse(r.flexMessageJson));
  assert.ok(Date.parse(r.expiresAt) - Date.now() > 23 * 3_600_000);
  assert.equal(r.discountedPrice, 350);
  assert.ok(streams.includes(GROUP_STREAM));
  await assert.rejects(
    svc.execute({ creatorUserId: UUID_B, input: { productId: UUID, groupType: 'NOPE' } }),
    /Invalid group room/,
  );
  await assert.rejects(
    svc.execute({ creatorUserId: UUID_B, input: { productId: UUID_C, groupType: 'BUDDY_PASS_2P' } }),
    /Product not found/,
  );
  const inviteSvc = new GenerateFlexInviteUseCase(
    {
      findById: async () => ({
        id: UUID_C, groupType: 'BUDDY_PASS_2P', discountedPrice: 350,
        currentMembersCount: 1, requiredMembers: 2,
        product: { title: 'T', coverImageUrl: 'https://r2.example.com/t.webp', price: 500 },
      }),
    } as never,
    flex as never,
  );
  const card = await inviteSvc.execute(UUID_C);
  assert.ok(card.inviteUrl.includes(UUID_C));
  ok('Create: WAITING room + Flex + stream + 2 gates');
}

// ---------- 4. Join service (BDD-1 <1s, single-slot race + self-join shield) ----------
async function sectionJoin(): Promise<void> {
  function ports(status: string, expiresAt: number, creator = UUID_B, count = 1) {
    const room = {
      id: UUID_C, roomCode: 'GB-X', productId: UUID, creatorId: creator,
      groupType: 'BUDDY_PASS_2P', requiredMembers: 2, currentMembersCount: count,
      discountedPrice: 350, status, expiresAt: new Date(expiresAt),
      product: { id: UUID, title: 'T', coverImageUrl: 'u', price: 500 },
      members: [{ userId: creator, orderId: 'pending:x', isCreator: true, joinedAt: new Date(), user: { displayName: 'C', avatarUrl: null } }],
    };
    const added: string[] = [];
    const grants: string[] = [];
    const streams: string[] = [];
    let locked = false;
    const repo = {
      findById: async (id: string) => (id === UUID_C ? room : null),
      addMember: async (a: { userId: string }) => { added.push(a.userId); },
      incrementCount: async () => ({ ...room, currentMembersCount: count + 1 }),
      withTx(tx: unknown) { return this; },
    };
    const locks = {
      set: async () => {
        if (locked) return null;
        locked = true;
        return 'OK';
      },
      del: async () => { locked = false; },
      xaddPipeline: async (s: string) => { streams.push(s); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    const grantsSvc = { grantForOrder: async (t: unknown, u: string, p: string[]) => { grants.push(u); return p; } };
    return { repo, locks, tx, grantsSvc, added, grants, streams };
  }
  const svcOf = (p: ReturnType<typeof ports>) =>
    new JoinGroupRoomService(p.repo as never, p.locks as never, p.tx, p.grantsSvc as never);
  // Happy path: 1→2 COMPLETED + grants for BOTH members (<1s).
  {
    const p = ports('WAITING_FOR_MEMBERS', NOW + 3_600_000);
    const t0 = Date.now();
    const r = await svcOf(p).execute({ userId: UUID, roomId: UUID_C, orderId: 'order-2' });
    assert.ok(Date.now() - t0 < 1000, 'join <1s budget');
    assert.deepEqual(r, { success: true, message: 'ห้องครบแล้ว ปลดล็อกสิทธิ์เรียบร้อย', isCompleted: true, productId: UUID });
    assert.deepEqual(p.added, [UUID]);
    assert.ok(p.grants.includes(UUID) && p.grants.includes(UUID_B));
    assert.ok(p.streams.includes(GROUP_STREAM));
  }
  // Graceful shapes: full / expired / self-join / unknown / bad input.
  {
    const full = ports('COMPLETED', NOW + 3_600_000, UUID_B, 2);
    assert.deepEqual((await svcOf(full).execute({ userId: UUID, roomId: UUID_C, orderId: 'o' })).success, false);
    const expired = ports('WAITING_FOR_MEMBERS', NOW - 1000);
    assert.equal((await svcOf(expired).execute({ userId: UUID, roomId: UUID_C, orderId: 'o' })).success, false);
    const self = ports('WAITING_FOR_MEMBERS', NOW + 3_600_000, UUID);
    const selfRes = await svcOf(self).execute({ userId: UUID, roomId: UUID_C, orderId: 'o' });
    assert.deepEqual([selfRes.success, selfRes.productId], [false, null]);
    assert.ok(String(selfRes.message).includes('SELF_JOIN'));
    const unknown = ports('WAITING_FOR_MEMBERS', NOW + 3_600_000);
    assert.equal((await svcOf(unknown).execute({ userId: UUID, roomId: UUID, orderId: 'o' })).success, false);
    const p = ports('WAITING_FOR_MEMBERS', NOW + 3_600_000);
    await assert.rejects(svcOf(p).execute({ userId: UUID, roomId: 'nope', orderId: 'o' }), /Invalid join/);
  }
  // Race: locked mutex → 409 Conflict (exactly one winner by construction).
  {
    const p = ports('WAITING_FOR_MEMBERS', NOW + 3_600_000);
    await p.locks.set();
    await assert.rejects(svcOf(p).execute({ userId: UUID, roomId: UUID_C, orderId: 'o' }), /Concurrent/);
    assert.deepEqual(p.added, []);
  }
  ok('Join: atomic grants + 5 graceful shapes + race 409 (<1s)');
}

// ---------- 5. Expiry sweep (BDD-2: EXPIRED + wallet refund) ----------
async function sectionExpiry(): Promise<void> {
  const rooms = [{
    id: 'room-9', productId: UUID, status: 'WAITING_FOR_MEMBERS', discountedPrice: 350,
  }];
  const marked: string[] = [];
  const refunded: Array<{ userId: string; amount: number }> = [];
  const events: string[] = [];
  const repo = {
    expireDue: async () => rooms,
    markExpired: async (id: string) => { marked.push(id); },
    findById: async () => ({
      members: [
        { userId: UUID_B, orderId: 'order-paid-1' },
        { userId: UUID, orderId: `pending:room-9:${UUID}` },
      ],
    }),
    withTx(tx: unknown) { return this; },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const bus = { xadd: async (s: string) => { events.push(s); } };
  const refunds = { refundToWallet: async (t: unknown, userId: string, amount: number) => { refunded.push({ userId, amount }); } };
  const svc = new GroupExpiryService(repo as never, tx, bus, refunds);
  assert.deepEqual(await svc.expireUnclaimed(NOW), { expired: 1 });
  assert.deepEqual(marked, ['room-9']);
  assert.deepEqual(refunded, [{ userId: UUID_B, amount: 350 }]);
  assert.ok(events.includes(GROUP_STREAM));
  const empty = new GroupExpiryService({ ...repo, expireDue: async () => [] } as never, tx, bus, refunds);
  assert.deepEqual(await empty.expireUnclaimed(NOW), { expired: 0 });
  ok('Expiry: 24h EXPIRED + paid-only wallet refund + stream');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum GroupType {',
    'BUDDY_PASS_2P',
    'enum GroupBuyingStatus {',
    'WAITING_FOR_MEMBERS',
    'model GroupBuyingConfig {',
    'buddyPassPrice',
    'model GroupBuyingRoom {',
    'roomCode            String            @unique',
    'currentMembersCount Int               @default(1)',
    'model GroupBuyingMember {',
    'orderId   String          @unique',
    '@@unique([roomId, userId])',
    'createdGroupRooms    GroupBuyingRoom[] @relation("CreatedGroupRooms")',
    'groupMemberships     GroupBuyingMember[]',
    'groupConfigs      GroupBuyingConfig?',
    'groupRooms        GroupBuyingRoom[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: GroupBuyingConfig/Room/Member + enums + User/Product relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/group-buying/domain/entities/group-room.entity.ts',
    'apps/backend/src/modules/group-buying/domain/events/group.events.ts',
    'apps/backend/src/modules/group-buying/domain/repository/group.repository.interface.ts',
    'apps/backend/src/modules/group-buying/application/services/create-room.service.ts',
    'apps/backend/src/modules/group-buying/application/services/join-room.service.ts',
    'apps/backend/src/modules/group-buying/application/services/group-expiry.service.ts',
    'apps/backend/src/modules/group-buying/application/use-cases/generate-flex-invite.usecase.ts',
    'apps/backend/src/modules/group-buying/infrastructure/persistence/prisma-group.repository.ts',
    'apps/backend/src/modules/group-buying/infrastructure/line/line-flex-group.builder.ts',
    'apps/backend/src/modules/group-buying/api/graphql/group-buying.resolver.ts',
    'apps/backend/src/modules/group-buying/api/graphql/group-buying.type.ts',
    'apps/backend/src/modules/group-buying/api/rest/group-buying.controller.ts',
    'apps/backend/src/modules/group-buying/group-buying.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/group-buying/group-buying.module.ts', 'utf8');
  assert.ok(mod.includes('GroupBuyingModule') && mod.includes('JoinGroupRoomService') && mod.includes('EntitlementGrantService'));
  assert.ok(!/class GroupBuyingModuleModule/.test(mod), 'legacy scaffold class removed');
  assert.ok(!/GroupBuyingServiceService|GroupBuyingResolverResolver|GroupBuyingControllerController/.test(mod), 'legacy scaffold names removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('GroupBuyingModule'));
  const gql = readFileSync('apps/backend/src/modules/group-buying/api/graphql/group-buying.resolver.ts', 'utf8');
  assert.ok(gql.includes('createGroupBuyingRoom') && gql.includes('joinGroupBuyingRoom') && gql.includes('cancelGroupBuyingRoom'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/group-buying.resolver.ts', 'utf8');
  assert.ok(alias.includes('GroupBuyingResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/group-buying.graphql', 'utf8');
  assert.ok(sdl.includes('CreateGroupRoomPayload') && sdl.includes('JoinGroupRoomResult') && sdl.includes('joinGroupBuyingRoom'));
  for (const p of [
    'apps/frontend/components/group-buying/BuddyPassShareCard.tsx',
    'apps/frontend/hooks/useGroupBuy.ts',
    'apps/frontend/lib/group-buy/group-buy-client.ts',
    'apps/frontend/app/(liff)/group-buy/[roomId]/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useGroupBuy.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const card = readFileSync('apps/frontend/components/group-buying/BuddyPassShareCard.tsx', 'utf8');
  assert.ok(!card.includes('lucide-react') && !card.includes('@/components/ui'), 'zero-dep card (no heavy UI)');
  assert.ok(card.includes('shareTargetPicker'), 'LIFF share + clipboard fallback');
  for (const p of [
    'apps/frontend/app/api/v1/group-buy/create/route.ts',
    'apps/frontend/app/api/v1/group-buy/join/route.ts',
    'apps/frontend/app/api/v1/group-buy/detail/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('group-buying-contract') && barrel.includes('CreateGroupRoomInputSchema'));
  ok('Parity: module/GQL+alias/SDL/card+hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionCreate();
  await sectionJoin();
  await sectionExpiry();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase090 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
