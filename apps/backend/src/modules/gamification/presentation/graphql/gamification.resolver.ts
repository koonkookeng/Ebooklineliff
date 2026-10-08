// SSOT Phase 083 §3.2/Gate 1 — Gamification GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/gamification/presentation/graphql/gamification.resolver.ts
// (legacy class name GamificationResolverResolver renamed — no importers.)
// - Query.getGamificationProfile / getUserBadges / getRewardCatalog.
// - Mutation.executeDailyCheckin / redeemReward / buyStreakFreezeWithPoints.
// - Zero new deps.
import { Args, Field, Float, ID, Int, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { STREAK_FREEZE_PRICE_POINTS } from '@repo/shared';
import { DailyCheckinUseCase } from '../../application/use-cases/daily-checkin.use-case';
import { RedeemRewardUseCase } from '../../application/use-cases/redeem-reward.use-case';
import type { GamificationRepository } from '../../infrastructure/repositories/prisma-gamification.repository';
import { PrismaGamificationRepository } from '../../infrastructure/repositories/prisma-gamification.repository';

@ObjectType('GamificationProfile')
class GamificationProfileGql {
  @Field(() => Int) currentStreak!: number;
  @Field(() => Int) longestStreak!: number;
  @Field({ nullable: true }) lastCheckinDate!: string | null;
  @Field(() => Int) streakFreezeCount!: number;
  @Field() hasCheckedInToday!: boolean;
  @Field(() => Int) rewardPoints!: number;
  @Field(() => Int) unlockedBadgesCount!: number;
}

@ObjectType('BadgeUnlocked')
class BadgeUnlockedGql {
  @Field(() => ID) badgeId!: string;
  @Field() badgeName!: string;
  @Field() iconUrl!: string;
}

@ObjectType('DailyCheckinResult')
class DailyCheckinResultGql {
  @Field() success!: boolean;
  @Field() message!: string;
  @Field(() => Int) currentStreak!: number;
  @Field(() => Int) pointsEarned!: number;
  @Field(() => Float) bonusMultiplier!: number;
  @Field(() => BadgeUnlockedGql, { nullable: true }) badgeUnlocked!: BadgeUnlockedGql | null;
}

@ObjectType('Badge')
class BadgeGql {
  @Field(() => ID) id!: string;
  @Field() code!: string;
  @Field() name!: string;
  @Field() description!: string;
  @Field() iconUrl!: string;
  @Field() category!: string;
  @Field(() => Int) pointsReward!: number;
  @Field() isUnlocked!: boolean;
  @Field({ nullable: true }) unlockedAt!: string | null;
}

@ObjectType('RewardItem')
class RewardItemGql {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() description!: string;
  @Field() imageUrl!: string;
  @Field() rewardType!: string;
  @Field(() => Int) pointsRequired!: number;
  @Field(() => Int) stockQty!: number;
  @Field() isAvailable!: boolean;
}

@ObjectType('RedemptionResult')
class RedemptionResultGql {
  @Field() success!: boolean;
  @Field() redemptionCode!: string;
  @Field(() => Int) remainingPoints!: number;
  @Field() entitlementGranted!: boolean;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): string {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Resolver('Gamification')
export class GamificationResolver {
  constructor(
    private readonly checkin: DailyCheckinUseCase,
    private readonly redeem: RedeemRewardUseCase,
    private readonly repo: PrismaGamificationRepository,
  ) {}

  @Query('getGamificationProfile')
  async getGamificationProfile(@Context() ctx: LooseCtx) {
    const p = await (this.repo as GamificationRepository).profile(actorOf(ctx));
    return {
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      lastCheckinDate: p.lastCheckinDate,
      streakFreezeCount: p.freezeCount,
      hasCheckedInToday: p.hasCheckedInToday,
      rewardPoints: p.points,
      unlockedBadgesCount: p.badges,
    };
  }

  @Query('getUserBadges')
  async getUserBadges(@Context() ctx: LooseCtx) {
    const repo: GamificationRepository = this.repo;
    const userId = actorOf(ctx);
    const [rules, unlocked] = await Promise.all([
      repo.ensureSeedBadges(),
      repo.unlockedBadgeIds(userId),
    ]);
    return rules.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      iconUrl: r.iconUrl,
      category: r.category,
      pointsReward: r.pointsReward,
      isUnlocked: unlocked.has(r.id),
      unlockedAt: null,
    }));
  }

  @Query('getRewardCatalog')
  async getRewardCatalog(@Context() ctx: LooseCtx) {
    const repo: GamificationRepository = this.repo;
    const userId = actorOf(ctx);
    const [items, wallet] = await Promise.all([repo.catalog(), repo.walletPoints(userId)]);
    return items.map((i) => ({
      ...i,
      isAvailable: i.isPublished && i.stockQty > 0 && wallet >= i.pointsRequired,
    }));
  }

  @Mutation('executeDailyCheckin')
  executeDailyCheckin(@Context() ctx: LooseCtx) {
    return this.checkin.execute(actorOf(ctx));
  }

  @Mutation('redeemReward')
  redeemReward(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    return this.redeem.execute(actorOf(ctx), input);
  }

  @Mutation('buyStreakFreezeWithPoints')
  async buyStreakFreezeWithPoints(@Context() ctx: LooseCtx) {
    const repo: GamificationRepository = this.repo;
    const userId = actorOf(ctx);
    const wallet = await repo.walletPoints(userId);
    if (wallet < STREAK_FREEZE_PRICE_POINTS) {
      throw new BadRequestException('คะแนนสะสมของคุณไม่เพียงพอสำหรับการแลก');
    }
    await repo.deductPoints(userId, STREAK_FREEZE_PRICE_POINTS);
    const freezeCount = await repo.addFreeze(userId, 1);
    const p = await repo.profile(userId);
    return {
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      lastCheckinDate: p.lastCheckinDate,
      streakFreezeCount: freezeCount,
      hasCheckedInToday: p.hasCheckedInToday,
      rewardPoints: p.points,
      unlockedBadgesCount: p.badges,
    };
  }
}
