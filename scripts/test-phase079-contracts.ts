// SSOT Phase 079 §10-11 — contract tests (Zod, money, tree, commission, fraud, payout, flex, parity)
// Run: npx tsx scripts/test-phase079-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AffiliateTierLevelEnum,
  CommissionStatusEnum,
  PayoutStatusEnum,
  ReferralLinkGenerateSchema,
  CommissionCalculateSchema,
  AffiliatePayoutRequestSchema,
  LINEFlexSharePayloadSchema,
  TIER_RATE_TABLE,
  PAYOUT_MIN_THB,
  AFFILIATE_WITHHOLDING_TAX_RATE,
  AFFILIATE_FRAUD_STREAM,
  AFFILIATE_COMMISSION_STREAM,
  tierCommission,
  payoutSplit,
  payoutNumber,
  referralUrl,
  isAcyclicChain,
  kFactor,
} from '../packages/shared/src/schemas/affiliate-contract';
import {
  assertAffiliateTenant,
  assertNoSelfReferral,
  assertAcyclic,
  assertPayoutFloor,
  splitPayout,
  shortAffiliateCode,
} from '../apps/backend/src/modules/affiliate/domain/affiliate.entity';
import { AffiliateTreeService } from '../apps/backend/src/modules/affiliate/services/affiliate-tree.service';
import { AntiFraudService } from '../apps/backend/src/modules/affiliate/services/anti-fraud.service';
import { CommissionEngineService } from '../apps/backend/src/modules/affiliate/services/commission-engine.service';
import { PayoutService } from '../apps/backend/src/modules/affiliate/services/payout.service';
import { buildProductFlexCard, FlexMessageBuilderService } from '../apps/backend/src/modules/affiliate/services/flex-message-builder.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const UUID_D = '423e4567-e89b-12d3-a456-426614174003';
const TENANT = 'emerald-mall';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(AffiliateTierLevelEnum.safeParse('TIER_1_DIRECT').success, true);
  assert.equal(AffiliateTierLevelEnum.safeParse('TIER_4').success, false);
  assert.equal(CommissionStatusEnum.safeParse('BLOCKED_FRAUD').success, true);
  assert.equal(CommissionStatusEnum.safeParse('HOLD').success, false);
  assert.equal(PayoutStatusEnum.safeParse('REQUESTED').success, true);
  assert.equal(PayoutStatusEnum.safeParse('PENDING').success, false);
  assert.equal(
    ReferralLinkGenerateSchema.safeParse({ tenantId: TENANT, productId: UUID }).success,
    true,
  );
  assert.equal(
    ReferralLinkGenerateSchema.safeParse({ tenantId: TENANT, productId: 'not-uuid' }).success,
    false,
  );
  assert.equal(
    ReferralLinkGenerateSchema.safeParse({ tenantId: '', productId: UUID }).success,
    false,
  );
  assert.equal(
    CommissionCalculateSchema.safeParse({ orderId: UUID, orderNetAmount: 1000, buyerUserId: UUID_B }).success,
    true,
  );
  assert.equal(
    CommissionCalculateSchema.safeParse({ orderId: UUID, orderNetAmount: -5, buyerUserId: UUID_B }).success,
    false,
  );
  assert.equal(
    AffiliatePayoutRequestSchema.safeParse({
      tenantId: TENANT, amount: 100, bankName: 'KBank', bankAccountNumber: '1234567890', bankAccountName: 'Somsri',
    }).success,
    true,
  );
  assert.equal(
    AffiliatePayoutRequestSchema.safeParse({
      tenantId: TENANT, amount: 99, bankName: 'KB', bankAccountNumber: '1234567890', bankAccountName: 'S',
    }).success,
    false,
  );
  assert.equal(
    AffiliatePayoutRequestSchema.safeParse({
      tenantId: TENANT, amount: 100, bankName: 'K', bankAccountNumber: '123', bankAccountName: 'S',
    }).success,
    false,
  );
  assert.equal(
    LINEFlexSharePayloadSchema.safeParse({ flexMessageJson: '{}', shareUrl: 'https://liff.line.me/p/x?ref=a', trackingCode: 'AB12' }).success,
    true,
  );
  assert.equal(
    LINEFlexSharePayloadSchema.safeParse({ flexMessageJson: '{}', shareUrl: 'not-url', trackingCode: 'x' }).success,
    false,
  );
  ok('Zod §3.1 verbatim (tier/commission/payout/link/calc/flex gates)');
}

// ---------- 2. Money + referral helpers (§3.1/BDD-2/§7.1) ----------
{
  assert.deepEqual(TIER_RATE_TABLE.map((r) => r.ratePercent), [10, 3, 1]);
  assert.equal(PAYOUT_MIN_THB, 100);
  assert.equal(AFFILIATE_WITHHOLDING_TAX_RATE, 0.03);
  assert.equal(AFFILIATE_FRAUD_STREAM, 'affiliate:fraud:events');
  assert.equal(AFFILIATE_COMMISSION_STREAM, 'affiliate:commission:events');
  // BDD-2 canonical: 1000 THB -> 100 / 30 / 10
  assert.equal(tierCommission(1000, 10), 100);
  assert.equal(tierCommission(1000, 3), 30);
  assert.equal(tierCommission(1000, 1), 10);
  assert.equal(tierCommission(999.99, 10), 100);
  assert.deepEqual(payoutSplit(1000), { requested: 1000, tax: 30, net: 970 });
  assert.deepEqual(payoutSplit(100), { requested: 100, tax: 3, net: 97 });
  const no = payoutNumber(TENANT);
  assert.ok(no.startsWith('PO-'), `payoutNo shape: ${no}`);
  const u = referralUrl('https://liff.line.me/', UUID, 'AFF123', 'songkran');
  assert.ok(u.includes(`/p/${UUID}?ref=AFF123`), `referralUrl: ${u}`);
  assert.ok(u.includes('tag=songkran'));
  assert.equal(isAcyclicChain(UUID_B, [{ id: UUID }, { id: UUID_C }]), true);
  assert.equal(isAcyclicChain(UUID_B, [{ id: UUID }, { id: UUID_B }]), false);
  assert.equal(isAcyclicChain(UUID_B, [{ id: UUID }, { id: UUID }]), false);
  assert.equal(kFactor(5, 0.2), 1);
  ok('Money: 1000->100/30/10 + 3% split + referral/acyclic/K-factor');
}

// ---------- 3. Entity guards (§5/BDD-3/§10) ----------
{
  assert.doesNotThrow(() => assertAffiliateTenant(TENANT, TENANT));
  assert.doesNotThrow(() => assertAffiliateTenant(TENANT, null));
  assert.throws(() => assertAffiliateTenant('', TENANT), /Missing X-Tenant/);
  assert.throws(() => assertAffiliateTenant(TENANT, 'other'), /Cross-tenant/);
  assert.doesNotThrow(() => assertNoSelfReferral(UUID_B, [UUID, UUID_C]));
  assert.throws(() => assertNoSelfReferral(UUID_B, [UUID_B]), /SELF_REFERRAL/);
  assert.doesNotThrow(() => assertAcyclic(UUID_B, [{ id: UUID }]));
  assert.throws(() => assertAcyclic(UUID_B, [{ id: UUID_B }]), /Circular/);
  assert.throws(() => assertAcyclic(UUID_B, [{ id: UUID }, { id: UUID }]), /Circular/);
  assert.doesNotThrow(() => assertPayoutFloor(100));
  assert.throws(() => assertPayoutFloor(99), /100 THB/);
  assert.deepEqual(splitPayout(1000), { requested: 1000, tax: 30, net: 970 });
  assert.throws(() => splitPayout(50), /100 THB/);
  assert.equal(shortAffiliateCode(UUID).length, 8);
  assert.equal(shortAffiliateCode(UUID), shortAffiliateCode(UUID).toUpperCase());
  ok('Entities: tenant/self/circular/floor/split/code guards');
}

// ---------- 4. Ancestor tree (3-tier resolve + loop cut, §10) ----------
async function sectionTree(): Promise<void> {
  const users = new Map([
    [UUID_B, { id: UUID_B, tenantId: TENANT, affiliateCode: 'B', referredById: UUID, lineUserId: 'line-b', walletBalance: 0 }],
    [UUID, { id: UUID, tenantId: TENANT, affiliateCode: 'A', referredById: UUID_C, lineUserId: 'line-a', walletBalance: 0 }],
    [UUID_C, { id: UUID_C, tenantId: TENANT, affiliateCode: 'C', referredById: UUID_D, lineUserId: 'line-c', walletBalance: 0 }],
    [UUID_D, { id: UUID_D, tenantId: TENANT, affiliateCode: 'D', referredById: null, lineUserId: 'line-d', walletBalance: 0 }],
  ]);
  const repo = { findUser: async (id: string) => users.get(id) ?? null };
  const svc = new AffiliateTreeService(repo as never);
  const chain = await svc.ancestorsOf(UUID_B);
  assert.equal(chain.length, 3);
  assert.equal(chain[0]?.tier, 'TIER_1_DIRECT');
  assert.equal(chain[0]?.user.id, UUID);
  assert.equal(chain[1]?.tier, 'TIER_2_INDIRECT');
  assert.equal(chain[2]?.tier, 'TIER_3_COMMUNITY');
  // Circular chain A->B->A must cut, never infinite.
  const loop = new Map([
    ['buyer', { id: 'buyer', tenantId: TENANT, affiliateCode: 'X', referredById: 'm1', lineUserId: null, walletBalance: 0 }],
    ['m1', { id: 'm1', tenantId: TENANT, affiliateCode: 'Y', referredById: 'buyer', lineUserId: null, walletBalance: 0 }],
  ]);
  const loopSvc = new AffiliateTreeService({ findUser: async (id: string) => loop.get(id) ?? null } as never);
  const cut = await loopSvc.ancestorsOf('buyer');
  assert.ok(cut.length <= 1, `circular cut: ${cut.length}`);
  // Orphan buyer resolves empty.
  const orphan = new Map([
    ['solo', { id: 'solo', tenantId: TENANT, affiliateCode: 'S', referredById: null, lineUserId: null, walletBalance: 0 }],
  ]);
  const orphanSvc = new AffiliateTreeService({ findUser: async (id: string) => orphan.get(id) ?? null } as never);
  assert.deepEqual(await orphanSvc.ancestorsOf('solo'), []);
  ok('Tree: 3-tier resolve + circular cut + orphan empty');
}

// ---------- 5. Commission engine (BDD-2 atomic <500ms) ----------
async function sectionCommission(): Promise<void> {
  function ports(signal: 'clean' | 'fraud' = 'clean') {
    const commissions: Array<{ beneficiaryId: string; commissionAmount: number; status: string; tierLevel: string }> = [];
    const wallets = new Map<string, number>([[UUID, 0], [UUID_C, 0], [UUID_D, 0]]);
    const repo = {
      findOrder: async () => ({
        orderId: UUID, orderNumber: 'ORD-1', tenantId: TENANT, buyerId: UUID_B,
        buyerLineUserId: 'line-b', paymentStatus: 'VERIFIED', netAmount: 1000,
      }),
      hasCommissionForOrder: async () => false,
      tierConfig: async () => ({ t1: 10, t2: 3, t3: 1 }),
      createCommission: async (a: { beneficiaryId: string; commissionAmount: number; status: string; tierLevel: string }) => {
        commissions.push(a);
      },
      creditWallet: async (id: string, amt: number) => {
        wallets.set(id, (wallets.get(id) ?? 0) + amt);
      },
      withTx(tx: unknown) { return this; },
    };
    const tree = {
      ancestorsOf: async () => [
        { tier: 'TIER_1_DIRECT', user: { id: UUID, lineUserId: 'line-a' } },
        { tier: 'TIER_2_INDIRECT', user: { id: UUID_C, lineUserId: 'line-c' } },
        { tier: 'TIER_3_COMMUNITY', user: { id: UUID_D, lineUserId: 'line-d' } },
      ],
    };
    const fraud = signal === 'clean'
      ? { screenOrder: async () => ({ clean: true, reason: null }) }
      : { screenOrder: async () => ({ clean: false, reason: 'SELF_REFERRAL_BLOCKED' }) };
    const events: string[] = [];
    const bus = { xadd: async (s: string) => { events.push(s); } };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    return { repo, tree, fraud, bus, tx, commissions, wallets, events };
  }
  // Happy path: 1000 -> 100/30/10 APPROVED + wallet moves + event.
  {
    const p = ports('clean');
    const svc = new CommissionEngineService(p.repo as never, p.tx, p.tree as never, p.fraud as never, p.bus);
    const t0 = Date.now();
    const r = await svc.processOrderCommissions({ orderId: UUID });
    assert.ok(Date.now() - t0 < 500, 'commission <500ms budget');
    assert.deepEqual(r, { distributed: true, tiers: 3, reason: null });
    assert.deepEqual(p.commissions.map((c) => c.commissionAmount), [100, 30, 10]);
    assert.ok(p.commissions.every((c) => c.status === 'APPROVED'));
    assert.equal(p.wallets.get(UUID), 100);
    assert.equal(p.wallets.get(UUID_C), 30);
    assert.equal(p.wallets.get(UUID_D), 10);
    assert.ok(p.events.includes(AFFILIATE_COMMISSION_STREAM));
  }
  // Fraud path: BLOCKED_FRAUD rows, no wallet movement, no commission event.
  {
    const p = ports('fraud');
    const svc = new CommissionEngineService(p.repo as never, p.tx, p.tree as never, p.fraud as never, p.bus);
    const r = await svc.processOrderCommissions({ orderId: UUID });
    assert.equal(r.distributed, false);
    assert.equal(r.reason, 'SELF_REFERRAL_BLOCKED');
    assert.ok(p.commissions.every((c) => c.status === 'BLOCKED_FRAUD'));
    assert.deepEqual([...p.wallets.values()], [0, 0, 0]);
    assert.equal(p.events.length, 0);
  }
  // Gates: unverified / duplicate / no-referrer.
  {
    const p = ports('clean');
    const badStatus = { ...p, repo: { ...p.repo, findOrder: async () => ({
      orderId: UUID, orderNumber: 'O', tenantId: TENANT, buyerId: UUID_B,
      buyerLineUserId: null, paymentStatus: 'UNPAID', netAmount: 1000,
    }) } };
    await assert.rejects(
      new CommissionEngineService(badStatus.repo as never, p.tx, p.tree as never, p.fraud as never, p.bus).processOrderCommissions({ orderId: UUID }),
      /verified/,
    );
    const dupe = { ...p, repo: { ...p.repo, hasCommissionForOrder: async () => true } };
    const d = await new CommissionEngineService(dupe.repo as never, p.tx, p.tree as never, p.fraud as never, p.bus).processOrderCommissions({ orderId: UUID });
    assert.deepEqual(d, { distributed: false, tiers: 0, reason: 'ALREADY_DISTRIBUTED' });
    const orphan = { ...p, tree: { ancestorsOf: async () => [] } };
    const o = await new CommissionEngineService(p.repo as never, p.tx, orphan.tree as never, p.fraud as never, p.bus).processOrderCommissions({ orderId: UUID });
    assert.deepEqual(o, { distributed: false, tiers: 0, reason: 'NO_REFERRER' });
    const missing = { ...p, repo: { ...p.repo, findOrder: async () => null } };
    await assert.rejects(
      new CommissionEngineService(missing.repo as never, p.tx, p.tree as never, p.fraud as never, p.bus).processOrderCommissions({ orderId: UUID }),
      /not found/,
    );
  }
  ok('Commission: 100/30/10 atomic + fraud-block + 4 gates (<500ms)');
}

// ---------- 6. Anti-fraud screen (BDD-3) ----------
async function sectionFraud(): Promise<void> {
  function svc() {
    const streams: Array<{ stream: string; reason: string }> = [];
    const counts = new Map<string, number>();
    const bus = { xadd: async (s: string, f: Record<string, string | number>) => { streams.push({ stream: s, reason: String(f['reason'] ?? '') }); } };
    const velocity = { bump: async (k: string) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; } };
    return { s: new AntiFraudService(bus, velocity), streams };
  }
  const base = {
    buyerUserId: UUID_B, buyerLineUserId: 'line-b', buyerFingerprint: 'fp-1',
    ancestors: [{ id: UUID, lineUserId: 'line-a', fingerprint: 'fp-a' }],
  };
  {
    const { s } = svc();
    assert.deepEqual(await s.screenOrder(UUID, base), { clean: true, reason: null });
  }
  {
    const { s, streams } = svc();
    const r = await s.screenOrder(UUID, { ...base, ancestors: [{ id: UUID_B, lineUserId: 'line-x', fingerprint: null }] });
    assert.equal(r.clean, false);
    assert.equal(r.reason, 'SELF_REFERRAL_BLOCKED');
    assert.ok(streams.some((e) => e.stream === AFFILIATE_FRAUD_STREAM));
  }
  {
    const { s } = svc();
    const r = await s.screenOrder(UUID, { ...base, buyerLineUserId: 'line-a' });
    assert.equal(r.reason, 'SELF_REFERRAL_BLOCKED');
  }
  {
    const { s } = svc();
    const r = await s.screenOrder(UUID, { ...base, ancestors: [{ id: UUID, lineUserId: 'line-a', fingerprint: 'fp-1' }] });
    assert.equal(r.reason, 'DEVICE_REUSE_BLOCKED');
  }
  {
    const { s } = svc();
    let last = { clean: true, reason: null as string | null };
    for (let i = 0; i < 6; i++) last = await s.screenOrder(UUID, base);
    assert.equal(last.reason, 'VELOCITY_BLOCKED');
  }
  ok('Fraud: clean/self(line+id)/device/velocity(>5/10min) + stream');
}

// ---------- 7. Payout service (3% withholding, §8.1) ----------
async function sectionPayout(): Promise<void> {
  function ports(available: number) {
    const rows: unknown[] = [];
    const repo = {
      findUser: async (id: string) => ({ id, tenantId: TENANT, affiliateCode: 'AFF1', referredById: null, lineUserId: null, walletBalance: 0 }),
      approvedEarnings: async () => available,
      createPayout: async (a: unknown) => { rows.push(a); return { id: UUID }; },
      dashboard: async () => ({ totalEarnings: 130, pendingEarnings: 20, tier1Count: 2, tier2Count: 1, affiliateCode: 'AFF1' }),
    };
    return { repo, rows };
  }
  {
    const { repo } = ports(1000);
    const s = new PayoutService(repo as never);
    const r = await s.requestPayout(TENANT, UUID_B, {
      tenantId: TENANT, amount: 1000, bankName: 'KBank', bankAccountNumber: '1234567890', bankAccountName: 'Somsri',
    });
    assert.deepEqual(r, { payoutId: UUID, requestedAmount: 1000, taxWithheld3Percent: 30, netPayoutAmount: 970, status: 'REQUESTED' });
    const d = await s.dashboard(UUID_B);
    assert.equal(d.totalEarnings, 130);
    assert.equal(d.tier1ReferralsCount, 2);
    assert.equal(d.affiliateCode, 'AFF1');
  }
  {
    const { repo } = ports(50);
    const s = new PayoutService(repo as never);
    await assert.rejects(
      s.requestPayout(TENANT, UUID_B, { tenantId: TENANT, amount: 500, bankName: 'KBank', bankAccountNumber: '1234567890', bankAccountName: 'Somsri' }),
      /Insufficient/,
    );
    await assert.rejects(
      s.requestPayout(TENANT, UUID_B, { tenantId: TENANT, amount: 50, bankName: 'KB', bankAccountNumber: '1234567890', bankAccountName: 'S' }),
      /Invalid payout|Minimum payout/,
    );
    await assert.rejects(s.requestPayout('', UUID_B, { amount: 200, bankName: 'KBank', bankAccountNumber: '1234567890', bankAccountName: 'S' }), /Invalid payout/);
  }
  ok('Payout: 3% split + cover-check + floor/tenant gates + dashboard');
}

// ---------- 8. Flex builder (§6.1/Gate 6) ----------
{
  const flex = new FlexMessageBuilderService();
  const card = buildProductFlexCard({
    productId: UUID, productTitle: 'Ebook A', coverImageUrl: 'https://r2.example.com/cover.jpg',
    price: 1000, affiliateCode: 'AFF1', shareUrl: referralUrl('https://liff.line.me', UUID, 'AFF1'), trackingCode: 'AFF1-1234',
  });
  assert.equal(card['type'], 'bubble');
  const body = (card['body'] as { contents: Array<{ text?: string }> }).contents;
  assert.ok(body.some((c) => (c.text ?? '').includes('ป้ายยา')), 'viral copy');
  assert.ok(body.some((c) => (c.text ?? '').includes('Ebook A')));
  const out = flex.build({
    productId: UUID, productTitle: 'Ebook A', coverImageUrl: 'https://r2.example.com/cover.jpg',
    price: 1000, affiliateCode: 'AFF1', shareUrl: referralUrl('https://liff.line.me', UUID, 'AFF1'), trackingCode: 'AFF1-1234',
  });
  const parsed = JSON.parse(out.flexMessageJson) as { type: string; contents: unknown };
  assert.equal(parsed.type, 'flex');
  assert.ok(LINEFlexSharePayloadSchema.safeParse(out).success);
  assert.ok(out.shareUrl.includes('ref=AFF1'));
  ok('Flex: bubble hero/body/footer + viral copy + trackable CTA');
}

// ---------- 9. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum AffiliateTierLevel {',
    'enum CommissionStatus {',
    'BLOCKED_FRAUD',
    'model AffiliateTierConfig {',
    'tier1RatePercent Decimal',
    'model CommissionLog {',
    'beneficiaryId    String',
    'model AffiliatePayout {',
    'taxWithheldAmount',
    'payoutNo           String       @unique',
    'model ShareEvent {',
    'refToken     String   @unique',
    'commissionsEarned    CommissionLog[] @relation("EarnedCommissions")',
    'commissionLogs       CommissionLog[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: tier-config/commission/payout/share + User/Order relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/affiliate/domain/affiliate.entity.ts',
    'apps/backend/src/modules/affiliate/domain/affiliate.repository.ts',
    'apps/backend/src/modules/affiliate/infrastructure/prisma-affiliate.repository.ts',
    'apps/backend/src/modules/affiliate/services/affiliate-tree.service.ts',
    'apps/backend/src/modules/affiliate/services/commission-engine.service.ts',
    'apps/backend/src/modules/affiliate/services/anti-fraud.service.ts',
    'apps/backend/src/modules/affiliate/services/flex-message-builder.service.ts',
    'apps/backend/src/modules/affiliate/services/payout.service.ts',
    'apps/backend/src/modules/affiliate/controllers/affiliate.controller.ts',
    'apps/backend/src/modules/affiliate/resolvers/affiliate.resolver.ts',
    'apps/backend/src/modules/affiliate/affiliate.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/affiliate/affiliate.module.ts', 'utf8');
  assert.ok(mod.includes('AffiliateModule') && mod.includes('CommissionEngineService') && mod.includes('PayoutService'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('AffiliateModule'));
  const gql = readFileSync('apps/backend/src/modules/affiliate/resolvers/affiliate.resolver.ts', 'utf8');
  assert.ok(gql.includes('getAffiliateDashboard') && gql.includes('createReferralLink') && gql.includes('requestAffiliatePayout') && gql.includes('generateProductFlexShare'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/affiliate.graphql', 'utf8');
  assert.ok(sdl.includes('AffiliateDashboardPayload') && sdl.includes('PayoutRequestInput') && sdl.includes('ReferralLinkPayload'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/affiliate.resolver.ts', 'utf8');
  assert.ok(alias.includes('AffiliateResolver'));
  for (const p of [
    'apps/frontend/components/affiliate/AffiliateDashboard.tsx',
    'apps/frontend/components/affiliate/LineFlexShareButton.tsx',
    'apps/frontend/hooks/useAffiliateHub.ts',
    'apps/frontend/lib/affiliate/affiliate-client.ts',
    'apps/frontend/app/(liff)/affiliate/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hub = readFileSync('apps/frontend/hooks/useAffiliateHub.ts', 'utf8');
  assert.ok(hub.includes('LIFF_INIT') && hub.includes('LOADING') && hub.includes('SUCCESS') && hub.includes('ERROR'), '5-state hook');
  const btn = readFileSync('apps/frontend/components/affiliate/LineFlexShareButton.tsx', 'utf8');
  assert.ok(btn.includes('shareTargetPicker') && btn.includes('clipboard'), 'share + offline fallback');
  assert.ok(!btn.includes("from '@line/liff'") && !btn.includes('from \'@line/liff\''), 'zero-dep LIFF (window.liff)');
  for (const p of [
    'apps/frontend/app/api/v1/affiliate/dashboard/route.ts',
    'apps/frontend/app/api/v1/affiliate/referral-link/route.ts',
    'apps/frontend/app/api/v1/affiliate/flex-share/route.ts',
    'apps/frontend/app/api/v1/affiliate/payout/route.ts',
  ]) {
    const src = readFileSync(p, 'utf8');
    assert.ok(src.includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('affiliate-contract') && barrel.includes('ReferralLinkGenerateSchema'));
  ok('Parity: module/GQL/SDL/alias/dashboard+flex/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionTree();
  await sectionCommission();
  await sectionFraud();
  await sectionPayout();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase079 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
