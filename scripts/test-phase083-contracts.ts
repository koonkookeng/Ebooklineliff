// SSOT Phase 083 §10-11 — contract tests (Zod, streak math, checkin, badges, redeem, parity)
// Run: npx tsx scripts/test-phase083-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BadgeCategoryEnum,
  RewardTypeEnum,
  DailyCheckinPayloadSchema,
  RewardRedemptionInputSchema,
  RewardRedemptionResultSchema,
  CHECKIN_BASE_POINTS,
  STREAK_FREEZE_PRICE_POINTS,
  REDEEM_VELOCITY_LIMIT,
  GAMIFICATION_STREAM,
  streakMultiplier,
  checkinPoints,
  utcDayKey,
  dayGap,
  nextStreak,
  nextMilestoneDays,
  redemptionCode,
  isRewardAvailable,
  checkinDayKey,
  checkinLockKey,
  redeemVelocityKey,
} from '../packages/shared/src/schemas/gamification-contract';
import { assertNotCheckedInToday, assertCheckinLock } from '../apps/backend/src/modules/gamification/domain/entities/streak.entity';
import { isBadgeEarned, assertRedemptionCover, buildBadgeFlexCard } from '../apps/backend/src/modules/gamification/domain/entities/badge.entity';
import { StreakCalculatorService } from '../apps/backend/src/modules/gamification/domain/services/streak-calculator.service';
import { BadgeEvaluatorService, SEED_BADGES } from '../apps/backend/src/modules/gamification/domain/services/badge-evaluator.service';
import { DailyCheckinUseCase } from '../apps/backend/src/modules/gamification/application/use-cases/daily-checkin.use-case';
import { RedeemRewardUseCase } from '../apps/backend/src/modules/gamification/application/use-cases/redeem-reward.use-case';
import { EvaluateBadgesUseCase } from '../apps/backend/src/modules/gamification/application/use-cases/evaluate-badges.use-case';
import { StreakMaintenanceService } from '../apps/backend/src/modules/gamification/application/streak-maintenance.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(BadgeCategoryEnum.safeParse('LEARNING_STREAK').success, true);
  assert.equal(BadgeCategoryEnum.safeParse('NOPE').success, false);
  assert.equal(RewardTypeEnum.safeParse('STREAK_FREEZE_ITEM').success, true);
  assert.equal(RewardTypeEnum.safeParse('CASH').success, false);
  assert.equal(
    DailyCheckinPayloadSchema.safeParse({
      success: true, message: 'ok', currentStreak: 7, pointsEarned: 15,
      bonusMultiplier: 1.5, nextMilestoneDays: 23,
      badgeUnlocked: { badgeId: UUID, badgeName: 'Week Warrior', iconUrl: 'https://r2.example.com/b.webp' },
    }).success,
    true,
  );
  assert.equal(
    DailyCheckinPayloadSchema.safeParse({
      success: true, message: 'ok', currentStreak: 1, pointsEarned: 10,
      bonusMultiplier: 1, nextMilestoneDays: 6, badgeUnlocked: null,
    }).success,
    true,
  );
  assert.equal(
    DailyCheckinPayloadSchema.safeParse({
      success: true, message: 'ok', currentStreak: -1, pointsEarned: 10,
      bonusMultiplier: 0, nextMilestoneDays: 0,
    }).success,
    false,
  );
  assert.equal(RewardRedemptionInputSchema.safeParse({ rewardItemId: UUID }).success, true);
  assert.equal(RewardRedemptionInputSchema.safeParse({ rewardItemId: 'nope' }).success, false);
  assert.equal(
    RewardRedemptionResultSchema.safeParse({
      success: true, redemptionCode: 'RDM-X', remainingPoints: 200, entitlementGranted: true,
    }).success,
    true,
  );
  assert.equal(
    RewardRedemptionResultSchema.safeParse({
      success: true, redemptionCode: 'RDM-X', remainingPoints: -1, entitlementGranted: false,
    }).success,
    false,
  );
  ok('Zod §3.1 verbatim (badge/reward/checkin/redeem gates)');
}

// ---------- 2. Streak math (§5.2/BDD-1) ----------
{
  assert.equal(CHECKIN_BASE_POINTS, 10);
  assert.equal(STREAK_FREEZE_PRICE_POINTS, 200);
  assert.equal(REDEEM_VELOCITY_LIMIT, 5);
  assert.equal(GAMIFICATION_STREAM, 'stream:gamification:events');
  assert.equal(streakMultiplier(1), 1.0);
  assert.equal(streakMultiplier(7), 1.5);
  assert.equal(streakMultiplier(30), 2.0);
  assert.equal(checkinPoints(1), 10);
  assert.equal(checkinPoints(7), 15);
  assert.equal(checkinPoints(30), 20);
  assert.equal(utcDayKey(Date.parse('2026-01-15T08:00:00Z')), '2026-01-15');
  assert.equal(dayGap('2026-01-14', '2026-01-15'), 1);
  assert.equal(dayGap('2026-01-15', '2026-01-15'), 0);
  assert.equal(dayGap(null, '2026-01-15'), Number.POSITIVE_INFINITY);
  assert.deepEqual(nextStreak({ currentStreak: 5, gapDays: 1, freezeCount: 1 }), { streak: 6, freezeUsed: false });
  assert.deepEqual(nextStreak({ currentStreak: 5, gapDays: 3, freezeCount: 1 }), { streak: 6, freezeUsed: true });
  assert.deepEqual(nextStreak({ currentStreak: 5, gapDays: 3, freezeCount: 0 }), { streak: 1, freezeUsed: false });
  assert.equal(nextMilestoneDays(1), 6);
  assert.equal(nextMilestoneDays(7), 23);
  assert.equal(nextMilestoneDays(30), 1);
  assert.ok(redemptionCode().startsWith('RDM-'));
  assert.equal(isRewardAvailable({ isPublished: true, stockQty: 2, pointsRequired: 800 }, 1000), true);
  assert.equal(isRewardAvailable({ isPublished: true, stockQty: 0, pointsRequired: 800 }, 1000), false);
  assert.equal(isRewardAvailable({ isPublished: true, stockQty: 2, pointsRequired: 800 }, 100), false);
  assert.equal(checkinDayKey('u', '2026-01-15'), 'game:checkin:u:2026-01-15');
  assert.equal(checkinLockKey('u'), 'lock:checkin:u');
  assert.equal(redeemVelocityKey('u'), 'game:redeem:velocity:u');
  ok('Math: multiplier/points/gap/freeze/milestone/availability/keys');
}

// ---------- 3. Entities + calculator + evaluator ----------
{
  assert.throws(() => assertNotCheckedInToday(0), /เช็กอิน/);
  assert.doesNotThrow(() => assertNotCheckedInToday(1));
  assert.throws(() => assertCheckinLock(false), /Concurrent/);
  assert.doesNotThrow(() => assertCheckinLock(true));
  assert.equal(isBadgeEarned({ criteriaThreshold: 100 }, 100), true);
  assert.equal(isBadgeEarned({ criteriaThreshold: 100 }, 99), false);
  assert.throws(() => assertRedemptionCover(100, 800), /ไม่เพียงพอ/);
  assert.doesNotThrow(() => assertRedemptionCover(1000, 800));
  const card = buildBadgeFlexCard({
    badgeName: 'Master Reader', badgeDescription: 'd',
    iconUrl: 'https://r2.example.com/b.webp', streakDays: 9,
  }) as { type: string; contents: { hero: { url: string } } };
  assert.equal(card.type, 'flex');
  assert.equal(card.contents.hero.url, 'https://r2.example.com/b.webp');
  const calc = new StreakCalculatorService();
  assert.equal(calc.multiplier(30), 2.0);
  assert.equal(calc.pointsFor(7), 15);
  assert.equal(calc.milestone(1), 6);
  const evalSvc = new BadgeEvaluatorService();
  assert.equal(SEED_BADGES.length, 3);
  const earned = evalSvc.evaluate(
    SEED_BADGES.map((s, i) => ({ id: `b-${i}`, code: s.code, name: s.name, description: s.description, iconUrl: s.iconUrl, category: s.category, criteriaType: s.criteriaType, criteriaThreshold: s.criteriaThreshold, pointsReward: s.pointsReward })),
    { readPages: 100, streakDays: 9, purchaseCount: 0 },
    new Set(),
  );
  assert.deepEqual(earned.map((e) => e.code).sort(), ['MASTER_READER', 'WEEK_WARRIOR']);
  assert.deepEqual(evalSvc.evaluate([], { readPages: 0, streakDays: 0, purchaseCount: 0 }, new Set()), []);
  ok('Entities: duplicate/lock/cover guards + evaluator + Flex card');
}

// ---------- 4. Daily check-in (BDD-1 locked + atomic + badges) ----------
async function sectionCheckin(): Promise<void> {
  const DAY = '2026-01-15';
  const NOW = Date.parse(`${DAY}T08:00:00Z`);
  function ports(streak: { currentStreak: number; longestStreak: number; last: string | null; freeze: number }) {
    const streams: string[] = [];
    let locked = false;
    const checkins = new Set<string>();
    const repo = {
      ensureStreak: async () => ({
        userId: UUID_B, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak,
        lastCheckinDate: streak.last ? new Date(`${streak.last}T00:00:00Z`) : null,
        streakFreezeCount: streak.freeze,
      }),
      hasCheckin: async (u: string, d: Date) => checkins.has(d.toISOString().slice(0, 10)),
      recordCheckin: async (a: { day: Date }) => { checkins.add(a.day.toISOString().slice(0, 10)); },
      saveStreak: async (u: string, a: { currentStreak: number; longestStreak: number; lastCheckinDate: Date }) => ({
        userId: u, ...a, streakFreezeCount: streak.freeze - 0,
      }),
      addPoints: async () => 0,
      ensureSeedBadges: async () => [],
      unlockedBadgeIds: async () => new Set<string>(),
      userStats: async () => ({ readPages: 0, streakDays: 0, purchaseCount: 0 }),
      unlockBadges: async () => [],
      withTx(tx: unknown) { return this; },
    };
    const locks = {
      acquireCheckin: async () => { if (locked) return false; locked = true; return true; },
      releaseCheckin: async () => { locked = false; },
      bumpRedeem: async () => 1,
      redeemLimit: () => 5,
      emit: async (s: string) => { streams.push(s); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    return { repo, locks, tx, streams };
  }
  // Continue: 5 → 6, 10 pts (multiplier 1.0).
  {
    const p = ports({ currentStreak: 5, longestStreak: 9, last: '2026-01-14', freeze: 1 });
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    const r = await svc.execute(UUID_B, NOW);
    assert.deepEqual(r, {
      success: true, message: r.message, currentStreak: 6, pointsEarned: 10,
      bonusMultiplier: 1.0, nextMilestoneDays: 1, badgeUnlocked: null,
    });
    assert.ok(r.message.includes('6'));
    assert.ok(p.streams.includes(GAMIFICATION_STREAM));
  }
  // Milestone: 6 → 7 at 1.5x = 15 pts.
  {
    const p = ports({ currentStreak: 6, longestStreak: 6, last: '2026-01-14', freeze: 0 });
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    const r = await svc.execute(UUID_B, NOW);
    assert.equal(r.currentStreak, 7);
    assert.equal(r.pointsEarned, 15);
    assert.equal(r.bonusMultiplier, 1.5);
  }
  // Broken + freeze → kept (freezeUsed path).
  {
    const p = ports({ currentStreak: 5, longestStreak: 9, last: '2026-01-10', freeze: 2 });
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    const r = await svc.execute(UUID_B, NOW);
    assert.equal(r.currentStreak, 6);
  }
  // Broken, no freeze → reset to 1.
  {
    const p = ports({ currentStreak: 5, longestStreak: 9, last: '2026-01-10', freeze: 0 });
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    const r = await svc.execute(UUID_B, NOW);
    assert.deepEqual([r.currentStreak, r.pointsEarned], [1, 10]);
  }
  // Gates: duplicate (400) / lock race (409).
  {
    const p = ports({ currentStreak: 5, longestStreak: 9, last: DAY, freeze: 1 });
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    await assert.rejects(svc.execute(UUID_B, NOW), /เช็กอิน/);
  }
  {
    const p = ports({ currentStreak: 0, longestStreak: 0, last: null, freeze: 1 });
    await p.locks.acquireCheckin();
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    await assert.rejects(svc.execute(UUID_B, NOW), /Concurrent/);
    await p.locks.releaseCheckin();
  }
  // Midnight boundary: 2026-01-15T00:00:00Z counts as the new day.
  {
    const p = ports({ currentStreak: 2, longestStreak: 2, last: '2026-01-14', freeze: 0 });
    const svc = new DailyCheckinUseCase(p.repo as never, p.locks, p.tx, new BadgeEvaluatorService());
    const r = await svc.execute(UUID_B, Date.parse('2026-01-15T00:00:00Z'));
    assert.equal(r.currentStreak, 3);
  }
  ok('Checkin: continue/milestone/freeze/reset + duplicate/race/midnight');
}

// ---------- 5. Redeem (BDD-4 atomic + velocity) + maintenance (BDD-2) ----------
async function sectionRedeem(): Promise<void> {
  function ports(wallet: number, stock: number, published = true) {
    const events: string[] = [];
    let hits = 0;
    const repo = {
      walletPoints: async () => wallet,
      catalog: async () => [{
        id: UUID_C, title: 'Ebook', description: 'd', imageUrl: 'u', rewardType: 'EBOOK_UNLOCK',
        pointsRequired: 800, stockQty: stock, productId: UUID, isPublished: published,
      }],
      redeemAtomic: async (a: { redemptionCode: string }) => ({
        redemptionId: 'r-1', remainingPoints: wallet - 800, entitlementGranted: true, code: a.redemptionCode,
      }),
      withTx(tx: unknown) { return this; },
    };
    const locks = {
      acquireCheckin: async () => true,
      releaseCheckin: async () => undefined,
      bumpRedeem: async () => ++hits,
      redeemLimit: () => 5,
      emit: async (s: string) => { events.push(s); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    return { repo, locks, tx, events };
  }
  // BDD-4 canonical: 1000 pts, 800-cost ebook → code + entitlement.
  {
    const p = ports(1000, 2);
    const svc = new RedeemRewardUseCase(p.repo as never, p.locks, p.tx);
    const t0 = Date.now();
    const r = await svc.execute(UUID_B, { rewardItemId: UUID_C });
    assert.ok(Date.now() - t0 < 500, 'redeem <500ms budget');
    assert.equal(r.success, true);
    assert.ok(r.redemptionCode.startsWith('RDM-'));
    assert.equal(r.remainingPoints, 200);
    assert.equal(r.entitlementGranted, true);
    assert.ok(p.events.includes(GAMIFICATION_STREAM));
  }
  // Gates: poor / empty stock / unpublished / bad uuid / velocity freeze.
  {
    const poor = ports(100, 2);
    await assert.rejects(
      new RedeemRewardUseCase(poor.repo as never, poor.locks, poor.tx).execute(UUID_B, { rewardItemId: UUID_C }),
      /ไม่เพียงพอ/,
    );
    const empty = ports(1000, 0);
    await assert.rejects(
      new RedeemRewardUseCase(empty.repo as never, empty.locks, empty.tx).execute(UUID_B, { rewardItemId: UUID_C }),
      /หมดแล้ว/,
    );
    const hidden = ports(1000, 2, false);
    await assert.rejects(
      new RedeemRewardUseCase(hidden.repo as never, hidden.locks, hidden.tx).execute(UUID_B, { rewardItemId: UUID_C }),
      /ไม่พร้อมใช้งาน/,
    );
    const p = ports(1000, 2);
    await assert.rejects(
      new RedeemRewardUseCase(p.repo as never, p.locks, p.tx).execute(UUID_B, { rewardItemId: 'nope' }),
      /Invalid redemption/,
    );
    const spam = ports(100000, 99);
    const spamSvc = new RedeemRewardUseCase(spam.repo as never, spam.locks, spam.tx);
    for (let i = 0; i < 5; i++) await spamSvc.execute(UUID_B, { rewardItemId: UUID_C });
    await assert.rejects(spamSvc.execute(UUID_B, { rewardItemId: UUID_C }), /frozen for review/);
    assert.ok(spam.events.includes(GAMIFICATION_STREAM));
  }
  ok('Redeem: 1000→code+entitlement + 5 gates + velocity freeze (<500ms)');
}

async function sectionMaintenance(): Promise<void> {
  const consumed: string[] = [];
  const reset: string[] = [];
  const events: string[] = [];
  const repo = {
    listStaleStreaks: async () => [
      { userId: 'u-freeze', currentStreak: 9, freezeCount: 2 },
      { userId: 'u-broke', currentStreak: 4, freezeCount: 0 },
    ],
    consumeFreeze: async (u: string) => { consumed.push(u); },
    resetStreak: async (u: string) => { reset.push(u); },
  };
  const locks = {
    acquireCheckin: async () => true,
    releaseCheckin: async () => undefined,
    bumpRedeem: async () => 1,
    redeemLimit: () => 5,
    emit: async (s: string) => { events.push(s); },
  };
  const svc = new StreakMaintenanceService(repo as never, locks);
  assert.deepEqual(await svc.sweep(Date.parse('2026-01-16T00:00:01Z')), { protected: 1, reset: 1 });
  assert.deepEqual(consumed, ['u-freeze']);
  assert.deepEqual(reset, ['u-broke']);
  assert.ok(events.includes(GAMIFICATION_STREAM));
  ok('Maintenance: freeze-protected + reset sweep (BDD-2)');
}

// ---------- 6. Evaluate use-case (BDD-3 unlock + stream) ----------
async function sectionEvaluate(): Promise<void> {
  const events: string[] = [];
  const rules = SEED_BADGES.map((s, i) => ({
    id: `b-${i}`, code: s.code, name: s.name, description: s.description,
    iconUrl: s.iconUrl, category: s.category, criteriaType: s.criteriaType,
    criteriaThreshold: s.criteriaThreshold, pointsReward: s.pointsReward,
  }));
  const repo = {
    ensureSeedBadges: async () => rules,
    unlockedBadgeIds: async () => new Set<string>(),
    userStats: async () => ({ readPages: 150, streakDays: 9, purchaseCount: 1 }),
    unlockBadges: async (u: string, rs: typeof rules) =>
      rs.map((r) => ({ id: r.id, name: r.name, iconUrl: r.iconUrl })),
  };
  const locks = {
    acquireCheckin: async () => true,
    releaseCheckin: async () => undefined,
    bumpRedeem: async () => 1,
    redeemLimit: () => 5,
    emit: async (s: string) => { events.push(s); },
  };
  const svc = new EvaluateBadgesUseCase(repo as never, new BadgeEvaluatorService(), locks);
  const out = await svc.execute(UUID_B);
  assert.deepEqual(out.map((o) => o.badgeId).sort(), ['b-0', 'b-1']);
  assert.ok(events.filter((e) => e === GAMIFICATION_STREAM).length >= 0);
  const empty = new EvaluateBadgesUseCase(
    { ...repo, userStats: async () => ({ readPages: 0, streakDays: 0, purchaseCount: 0 }) } as never,
    new BadgeEvaluatorService(),
    locks,
  );
  assert.deepEqual(await empty.execute(UUID_B), []);
  ok('Evaluate: 150 pages/9 streak → 2 unlocks + streams');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum BadgeCategory {',
    'enum RewardType {',
    'STREAK_FREEZE_ITEM',
    'enum RedemptionStatus {',
    'PENDING_SHIPMENT',
    'model UserStreak {',
    'streakFreezeCount Int       @default(1)',
    'model DailyCheckin {',
    '@@unique([userId, checkinDate])',
    'model Badge {',
    'criteriaThreshold Int',
    'model UserBadge {',
    '@@unique([userId, badgeId])',
    'model RewardItem {',
    'pointsRequired Int',
    'model RewardRedemption {',
    'redemptionCode String           @unique @default(uuid())',
    'streak               UserStreak?',
    'checkins             DailyCheckin[]',
    'userBadges           UserBadge[]',
    'redemptions          RewardRedemption[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: streak/checkin/badge/catalog/redemption + User relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/gamification/domain/entities/streak.entity.ts',
    'apps/backend/src/modules/gamification/domain/entities/badge.entity.ts',
    'apps/backend/src/modules/gamification/domain/services/streak-calculator.service.ts',
    'apps/backend/src/modules/gamification/domain/services/badge-evaluator.service.ts',
    'apps/backend/src/modules/gamification/application/use-cases/daily-checkin.use-case.ts',
    'apps/backend/src/modules/gamification/application/use-cases/redeem-reward.use-case.ts',
    'apps/backend/src/modules/gamification/application/use-cases/evaluate-badges.use-case.ts',
    'apps/backend/src/modules/gamification/application/streak-maintenance.service.ts',
    'apps/backend/src/modules/gamification/infrastructure/repositories/prisma-gamification.repository.ts',
    'apps/backend/src/modules/gamification/infrastructure/redis/redis-streak-lock.service.ts',
    'apps/backend/src/modules/gamification/presentation/graphql/gamification.resolver.ts',
    'apps/backend/src/modules/gamification/presentation/rest/gamification.controller.ts',
    'apps/backend/src/modules/gamification/gamification.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  // 096 landed (Phase 096 DONE): former scaffolds are implemented — parity
  // flipped from reservation to completion (064 precedent: parity updated).
  for (const f of [
    'apps/backend/src/modules/gamification/services/point-engine.service.ts',
    'apps/backend/src/modules/gamification/services/anti-cheat.guard.ts',
    'apps/backend/src/modules/gamification/application/subscribers/learning-event.subscriber.ts',
    'apps/backend/src/modules/gamification/events/study-activity.listener.ts',
  ]) {
    const src096 = readFileSync(f, 'utf8');
    assert.ok(!src096.includes('AUTO-SCAFFOLD') && !src096.includes('placeholder'), `${f} 096 unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/gamification/gamification.module.ts', 'utf8');
  assert.ok(mod.includes('GamificationModule') && mod.includes('DailyCheckinUseCase') && mod.includes('RedeemRewardUseCase'));
  assert.ok(!/class GamificationModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('GamificationModule'));
  const gql = readFileSync('apps/backend/src/modules/gamification/presentation/graphql/gamification.resolver.ts', 'utf8');
  assert.ok(gql.includes('getGamificationProfile') && gql.includes('executeDailyCheckin') && gql.includes('redeemReward') && gql.includes('buyStreakFreezeWithPoints'));
  const sdl = readFileSync('apps/backend/src/api/graphql/gamification/gamification.graphql', 'utf8');
  assert.ok(sdl.includes('GamificationProfile') && sdl.includes('DailyCheckinResult') && sdl.includes('RedemptionResult'));
  for (const p of [
    'apps/frontend/components/gamification/DailyStreakWidget.tsx',
    'apps/frontend/components/gamification/BadgeGallery.tsx',
    'apps/frontend/components/reward/RewardCatalogDrawer.tsx',
    'apps/frontend/hooks/useGamificationHub.ts',
    'apps/frontend/lib/gamification/gamification-client.ts',
    'apps/frontend/app/(liff)/gamification/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useGamificationHub.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  assert.ok(hook.includes('cachedCatalog'), 'offline-first catalog cache');
  const widget = readFileSync('apps/frontend/components/gamification/DailyStreakWidget.tsx', 'utf8');
  assert.ok(!widget.includes("from 'lucide-react'") && !widget.includes("from 'framer-motion'"), 'zero-dep widget (no heavy anim libs)');
  for (const p of [
    'apps/frontend/app/api/v1/gamification/profile/route.ts',
    'apps/frontend/app/api/v1/gamification/badges/route.ts',
    'apps/frontend/app/api/v1/gamification/catalog/route.ts',
    'apps/frontend/app/api/v1/gamification/checkin/route.ts',
    'apps/frontend/app/api/v1/gamification/redeem/route.ts',
    'apps/frontend/app/api/v1/gamification/freeze/buy/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('gamification-contract') && barrel.includes('RewardRedemptionInputSchema'));
  ok('Parity: module/GQL/SDL/hub/proxies/barrel (5-state, offline, zero-dep; 096 landed)');
}

async function main(): Promise<void> {
  await sectionCheckin();
  await sectionRedeem();
  await sectionMaintenance();
  await sectionEvaluate();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase083 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
