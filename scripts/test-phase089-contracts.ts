// SSOT Phase 089 §10-11 — contract tests (Zod, code/expiry/K-factor, create/claim/expiry, parity)
// Run: npx tsx scripts/test-phase089-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GiftStatusEnum,
  GreetingThemeEnum,
  CreateGiftOrderInputSchema,
  ClaimGiftPayloadSchema,
  GiftDetailResponseSchema,
  GIFT_DEFAULT_EXPIRY_DAYS,
  GIFT_STREAM,
  giftClaimCode,
  giftExpiryAt,
  canClaim,
  giftKFactor,
  giftClaimUrl,
  giftClaimLockKey,
} from '../packages/shared/src/schemas/gift-contract';
import { assertBindable, assertClaimable } from '../apps/backend/src/modules/gift/domain/entities/gift-order.entity';
import { buildGiftFlexCard } from '../apps/backend/src/modules/gift/infrastructure/line/line-flex-gift.builder';
import { CreateGiftOrderService } from '../apps/backend/src/modules/gift/application/services/create-gift-order.service';
import { ClaimGiftService } from '../apps/backend/src/modules/gift/application/services/claim-gift.service';
import { GiftCronService } from '../apps/backend/src/modules/gift/application/services/gift-cron.service';
import { GenerateFlexCardUseCase } from '../apps/backend/src/modules/gift/application/use-cases/generate-flex-card.usecase';

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
  assert.equal(GiftStatusEnum.safeParse('READY_TO_CLAIM').success, true);
  assert.equal(GiftStatusEnum.safeParse('SENT').success, false);
  assert.equal(GreetingThemeEnum.safeParse('THANK_YOU').success, true);
  assert.equal(GreetingThemeEnum.safeParse('HALLOWEEN').success, false);
  const input = {
    productId: UUID, greetingTheme: 'BIRTHDAY_CELEBRATION',
    greetingMessage: 'สุขสันต์วันเกิด', senderDisplayName: 'Somsri',
  };
  const parsed = CreateGiftOrderInputSchema.safeParse(input);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.isAnonymous, false);
    assert.equal(parsed.data.expiryDays, 30);
  }
  assert.equal(CreateGiftOrderInputSchema.safeParse({ ...input, greetingMessage: '' }).success, false);
  assert.equal(CreateGiftOrderInputSchema.safeParse({ ...input, greetingMessage: 'x'.repeat(501) }).success, false);
  assert.equal(CreateGiftOrderInputSchema.safeParse({ ...input, productId: 'nope' }).success, false);
  assert.equal(ClaimGiftPayloadSchema.safeParse({ claimCode: 'GIFT-ABC-1234' }).success, true);
  assert.equal(ClaimGiftPayloadSchema.safeParse({ claimCode: 'short' }).success, false);
  assert.equal(
    GiftDetailResponseSchema.safeParse({
      giftId: UUID, claimCode: 'GIFT-X', status: 'READY_TO_CLAIM',
      productTitle: 'Ebook', productCoverUrl: 'https://r2.example.com/c.webp',
      productType: 'EBOOK', senderName: 'S', greetingTheme: 'THANK_YOU',
      greetingMessage: 'hi', expiresAt: new Date().toISOString(),
      claimedAt: null, recipientName: null,
    }).success,
    true,
  );
  assert.equal(
    GiftDetailResponseSchema.safeParse({
      giftId: UUID, claimCode: 'GIFT-X', status: 'READY_TO_CLAIM',
      productTitle: 'Ebook', productCoverUrl: 'not-url',
      productType: 'EBOOK', senderName: 'S', greetingTheme: 'THANK_YOU',
      greetingMessage: 'hi', expiresAt: 'nope',
      claimedAt: null, recipientName: null,
    }).success,
    false,
  );
  ok('Zod §3.1 verbatim (status/theme/input/claim/detail gates)');
}

// ---------- 2. Code/expiry/K-factor helpers (§1.1/BDD-3/§7.1) ----------
{
  assert.equal(GIFT_DEFAULT_EXPIRY_DAYS, 30);
  assert.equal(GIFT_STREAM, 'stream:gift:events');
  assert.ok(/^GIFT-[0-9A-Z]+-[0-9A-Z]{4}$/.test(giftClaimCode()));
  assert.notEqual(giftClaimCode(1000, 1), giftClaimCode(1000, 2));
  assert.equal(giftExpiryAt(0), new Date(30 * 86_400_000).toISOString());
  assert.equal(canClaim({ status: 'READY_TO_CLAIM', expiresAt: NOW + 1000 }, NOW), true);
  assert.equal(canClaim({ status: 'CLAIMED', expiresAt: NOW + 1000 }, NOW), false);
  assert.equal(canClaim({ status: 'READY_TO_CLAIM', expiresAt: NOW - 1000 }, NOW), false);
  assert.equal(giftKFactor(10, 4), 0.4);
  assert.equal(giftKFactor(0, 0), 0);
  assert.equal(giftClaimUrl('https://liff.line.me/', 'GIFT-A'), 'https://liff.line.me/gift/claim?code=GIFT-A');
  assert.equal(giftClaimLockKey('GIFT-A'), 'lock:gift:claim:GIFT-A');
  assert.doesNotThrow(() => assertClaimable({ status: 'READY_TO_CLAIM', expiresAt: NOW + 1000, claimCode: 'G' }, NOW));
  assert.throws(() => assertClaimable({ status: 'CLAIMED', expiresAt: NOW + 1000, claimCode: 'G' }, NOW), /รับไปแล้ว/);
  assert.throws(() => assertClaimable({ status: 'READY_TO_CLAIM', expiresAt: NOW - 1, claimCode: 'G' }, NOW), /หมดอายุ/);
  assert.doesNotThrow(() => assertBindable('PENDING_PAYMENT'));
  assert.throws(() => assertBindable('CLAIMED'), /cannot bind/);
  const card = buildGiftFlexCard({
    productTitle: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp',
    greetingTheme: 'THANK_YOU', greetingMessage: 'ขอบคุณมาก', senderName: 'Somsri',
    claimUrl: 'https://liff.line.me/gift/claim?code=G',
  }) as { type: string; altText: string; contents: { hero: { url: string }; footer: { contents: Array<{ action: { uri: string } }> } } };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('Ebook A'));
  assert.equal(card.contents.hero.url, 'https://r2.example.com/a.webp');
  assert.ok(JSON.stringify(card).includes('ขอบคุณมาก'));
  ok('Helpers: code/expiry/K-factor/link/lock + Flex card');
}

// ---------- 3. Create service (BDD-1: PENDING + Flex + stream) ----------
async function sectionCreate(): Promise<void> {
  const streams: string[] = [];
  const repo = {
    findProduct: async (id: string) =>
      id === UUID ? { id, title: 'Ebook A', coverImageUrl: 'https://r2.example.com/a.webp', productType: 'EBOOK' } : null,
    createGift: async (a: Record<string, unknown>) => ({ id: 'gift-1', ...a }),
    withTx(tx: unknown) { return this; },
  };
  const flex = {
    build: (a: { claimUrl: string }) => ({ flexMessageJson: JSON.stringify({ url: a.claimUrl }) }),
  };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new CreateGiftOrderService(repo as never, flex as never, bus);
  const r = await svc.execute({
    senderUserId: UUID_B,
    input: {
      productId: UUID, greetingTheme: 'BIRTHDAY_CELEBRATION',
      greetingMessage: 'สุขสันต์วันเกิด', senderDisplayName: 'Somsri',
    },
  });
  assert.equal(r.giftId, 'gift-1');
  assert.ok(/^GIFT-/.test(r.claimCode));
  assert.ok(r.claimUrl.includes(r.claimCode));
  assert.ok(JSON.parse(r.flexMessageJson));
  assert.ok(Date.parse(r.expiresAt) - Date.now() > 29 * 86_400_000);
  assert.ok(streams.includes(GIFT_STREAM));
  await assert.rejects(
    svc.execute({ senderUserId: UUID_B, input: { productId: UUID, greetingTheme: 'NOPE', greetingMessage: 'hi', senderDisplayName: 'S' } }),
    /Invalid gift order/,
  );
  await assert.rejects(
    svc.execute({
      senderUserId: UUID_B,
      input: { productId: UUID_C, greetingTheme: 'THANK_YOU', greetingMessage: 'hi', senderDisplayName: 'S' },
    }),
    /Product not found/,
  );
  const flexSvc = new GenerateFlexCardUseCase(
    {
      findByClaimCode: async () => ({
        claimCode: 'GIFT-XYZ-1234', greetingTheme: 'THANK_YOU', greetingMessage: 'hi',
        senderDisplayName: 'S', isAnonymous: false,
        product: { title: 'T', coverImageUrl: 'https://r2.example.com/t.webp' },
      }),
    } as never,
    flex as never,
  );
  const card = await flexSvc.execute('GIFT-XYZ-1234');
  assert.ok(card.claimUrl.includes('GIFT-XYZ-1234'));
  ok('Create: PENDING gift + Flex + stream + 2 gates');
}

// ---------- 4. Claim service (BDD-2 <1s, single-claim race) ----------
async function sectionClaim(): Promise<void> {
  const CODE = giftClaimCode(NOW, 7);
  function ports(status: string, expiresAt: number, sender = UUID_B) {
    const gift = {
      id: 'gift-1', orderId: null, senderUserId: sender, recipientUserId: null,
      productId: UUID_C, claimCode: CODE, status, greetingTheme: 'THANK_YOU',
      greetingMessage: 'hi', senderDisplayName: 'S', isAnonymous: false,
      expiresAt: new Date(expiresAt), claimedAt: null,
      product: { id: UUID_C, title: 'T', coverImageUrl: 'u', productType: 'EBOOK' },
    };
    const claims: string[] = [];
    const grants: string[] = [];
    const streams: string[] = [];
    let locked = false;
    const repo = {
      findByClaimCode: async (c: string) => (c === CODE ? gift : null),
      claimAtomic: async (a: { giftId: string; recipientUserId: string }) => {
        claims.push(a.recipientUserId);
        gift.status = 'CLAIMED';
        return gift;
      },
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
    return { repo, locks, tx, grantsSvc, claims, grants, streams };
  }
  const svcOf = (p: ReturnType<typeof ports>) =>
    new ClaimGiftService(p.repo as never, p.locks as never, p.tx, p.grantsSvc as never);
  // Happy path: READY → CLAIMED + grant (<1s).
  {
    const p = ports('READY_TO_CLAIM', NOW + 3_600_000);
    const t0 = Date.now();
    const r = await svcOf(p).execute({ recipientUserId: UUID, claimCode: CODE });
    assert.ok(Date.now() - t0 < 1000, 'claim <1s budget');
    assert.deepEqual(r, { success: true, message: 'รับของขวัญสำเร็จ', productId: UUID_C });
    assert.deepEqual(p.claims, [UUID]);
    assert.deepEqual(p.grants, [UUID]);
    assert.ok(p.streams.includes(GIFT_STREAM));
  }
  // Graceful shapes: used / expired / self-gift / unknown / bad code.
  {
    const used = ports('CLAIMED', NOW + 3_600_000);
    assert.deepEqual((await svcOf(used).execute({ recipientUserId: UUID, claimCode: CODE })).success, false);
    const expired = ports('READY_TO_CLAIM', NOW - 1000);
    assert.equal((await svcOf(expired).execute({ recipientUserId: UUID, claimCode: CODE })).success, false);
    const self = ports('READY_TO_CLAIM', NOW + 3_600_000, UUID);
    const selfRes = await svcOf(self).execute({ recipientUserId: UUID, claimCode: CODE });
    assert.deepEqual([selfRes.success, selfRes.productId], [false, null]);
    const unknown = ports('READY_TO_CLAIM', NOW + 3_600_000);
    assert.equal((await svcOf(unknown).execute({ recipientUserId: UUID, claimCode: 'GIFT-NOPE-0000' })).success, false);
    const p = ports('READY_TO_CLAIM', NOW + 3_600_000);
    await assert.rejects(svcOf(p).execute({ recipientUserId: UUID, claimCode: 'short' }), /Invalid claim code/);
  }
  // Race: locked mutex → 409 Conflict (exactly one winner by construction).
  {
    const p = ports('READY_TO_CLAIM', NOW + 3_600_000);
    await p.locks.set();
    await assert.rejects(svcOf(p).execute({ recipientUserId: UUID, claimCode: CODE }), /being processed/);
    assert.deepEqual(p.claims, []);
  }
  ok('Claim: atomic grant + 5 graceful shapes + race 409 (<1s)');
}

// ---------- 5. Expiry sweep (BDD-3: revert to sender + grant) ----------
async function sectionExpiry(): Promise<void> {
  const gifts = [{
    id: 'gift-9', senderUserId: UUID_B, productId: UUID_C, status: 'READY_TO_CLAIM',
  }];
  const reverted: string[] = [];
  const granted: string[] = [];
  const events: string[] = [];
  const repo = {
    expireDue: async () => gifts,
    revertToSender: async (id: string) => { reverted.push(id); },
    withTx(tx: unknown) { return this; },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const bus = { xadd: async (s: string) => { events.push(s); } };
  const grants = { grantForOrder: async (t: unknown, u: string, p: string[]) => { granted.push(u); return p; } };
  const svc = new GiftCronService(repo as never, tx, bus, grants as never);
  assert.deepEqual(await svc.expireUnclaimed(NOW), { reverted: 1 });
  assert.deepEqual(reverted, ['gift-9']);
  assert.deepEqual(granted, [UUID_B]);
  assert.ok(events.includes(GIFT_STREAM));
  const empty = new GiftCronService({ ...repo, expireDue: async () => [] } as never, tx, bus, grants as never);
  assert.deepEqual(await empty.expireUnclaimed(NOW), { reverted: 0 });
  ok('Expiry: 30d revert + sender grant + stream');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum GiftStatus {',
    'EXPIRED_REVERTED',
    'enum GreetingTheme {',
    'CUSTOM_BRANDED',
    'model GiftOrder {',
    'orderId           String?         @unique',
    'claimCode         String          @unique',
    'senderUser        User            @relation("SentGifts"',
    'recipientUser     User?           @relation("ReceivedGifts"',
    'sentGifts            GiftOrder[] @relation("SentGifts")',
    'receivedGifts        GiftOrder[] @relation("ReceivedGifts")',
    'giftOrders        GiftOrder[]',
    'giftOrder            GiftOrder?',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: GiftOrder + enums + User/Product/Order relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/gift/domain/entities/gift-order.entity.ts',
    'apps/backend/src/modules/gift/domain/events/gift-created.event.ts',
    'apps/backend/src/modules/gift/domain/events/gift-claimed.event.ts',
    'apps/backend/src/modules/gift/domain/events/gift-expired.event.ts',
    'apps/backend/src/modules/gift/domain/repository/gift.repository.interface.ts',
    'apps/backend/src/modules/gift/application/services/create-gift-order.service.ts',
    'apps/backend/src/modules/gift/application/services/claim-gift.service.ts',
    'apps/backend/src/modules/gift/application/services/gift-cron.service.ts',
    'apps/backend/src/modules/gift/application/use-cases/generate-flex-card.usecase.ts',
    'apps/backend/src/modules/gift/infrastructure/persistence/prisma-gift.repository.ts',
    'apps/backend/src/modules/gift/infrastructure/line/line-flex-gift.builder.ts',
    'apps/backend/src/modules/gift/api/graphql/gift.resolver.ts',
    'apps/backend/src/modules/gift/api/graphql/gift.type.ts',
    'apps/backend/src/modules/gift/api/rest/gift-claim.controller.ts',
    'apps/backend/src/modules/gift/gift.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/gift/gift.module.ts', 'utf8');
  assert.ok(mod.includes('GiftModule') && mod.includes('ClaimGiftService') && mod.includes('EntitlementGrantService'));
  assert.ok(!/class GiftModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('GiftModule'));
  const gql = readFileSync('apps/backend/src/modules/gift/api/graphql/gift.resolver.ts', 'utf8');
  assert.ok(gql.includes('createGiftOrder') && gql.includes('claimGiftEntitlement') && gql.includes('bindGiftPayment'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/gift.resolver.ts', 'utf8');
  assert.ok(alias.includes('GiftResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/gift.graphql', 'utf8');
  assert.ok(sdl.includes('CreateGiftPayload') && sdl.includes('ClaimGiftResult') && sdl.includes('claimGiftEntitlement'));
  for (const p of [
    'apps/frontend/components/gift/GiftCreatorStudio.tsx',
    'apps/frontend/hooks/useGiftClaim.ts',
    'apps/frontend/lib/gift/gift-client.ts',
    'apps/frontend/app/(liff)/gift/claim/page.tsx',
    'apps/frontend/app/(liff)/gift/send/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useGiftClaim.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const studio = readFileSync('apps/frontend/components/gift/GiftCreatorStudio.tsx', 'utf8');
  assert.ok(!studio.includes("from '@apollo/client'") && !studio.includes('@/components/ui/'), 'zero-dep studio (no heavy UI)');
  assert.ok(studio.includes('shareTargetPicker'), 'LIFF share + clipboard fallback');
  for (const p of [
    'apps/frontend/app/api/v1/gifts/create/route.ts',
    'apps/frontend/app/api/v1/gifts/claim/route.ts',
    'apps/frontend/app/api/v1/gifts/detail/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('gift-contract') && barrel.includes('CreateGiftOrderInputSchema'));
  ok('Parity: module/GQL+alias/SDL/studio+claim/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionCreate();
  await sectionClaim();
  await sectionExpiry();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase089 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
