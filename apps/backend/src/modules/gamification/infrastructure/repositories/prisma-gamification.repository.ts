// SSOT Phase 083 §5.1 — Gamification repository port + structural adapter
// Canonical: apps/backend/src/modules/gamification/infrastructure/repositories/prisma-gamification.repository.ts
// - Check-ins/streaks/badges/catalog/redemptions + stat probes (read pages,
//   purchases) for the evaluator. Structural typing (078–082 precedent).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { SEED_BADGES } from '../../domain/services/badge-evaluator.service';
import type { BadgeRule } from '../../domain/entities/badge.entity';

export interface StreakRow {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastCheckinDate: Date | null;
  streakFreezeCount: number;
}

export interface GamificationRepository {
  withTx?(tx: unknown): GamificationRepository;
  ensureStreak(userId: string): Promise<StreakRow>;
  saveStreak(userId: string, args: { currentStreak: number; longestStreak: number; lastCheckinDate: Date; freezeUsed: boolean }): Promise<StreakRow>;
  addFreeze(userId: string, count: number): Promise<number>;
  hasCheckin(userId: string, day: Date): Promise<boolean>;
  recordCheckin(args: { userId: string; day: Date; streak: number; points: number; multiplier: number; freezeUsed: boolean }): Promise<void>;
  addPoints(userId: string, points: number): Promise<number>;
  walletPoints(userId: string): Promise<number>;
  deductPoints(userId: string, points: number): Promise<number>;
  ensureSeedBadges(): Promise<BadgeRule[]>;
  unlockedBadgeIds(userId: string): Promise<Set<string>>;
  unlockBadges(userId: string, rules: BadgeRule[]): Promise<Array<{ id: string; name: string; iconUrl: string }>>;
  userStats(userId: string): Promise<{ readPages: number; streakDays: number; purchaseCount: number }>;
  catalog(): Promise<Array<{
    id: string; title: string; description: string; imageUrl: string;
    rewardType: string; pointsRequired: number; stockQty: number;
    productId: string | null; isPublished: boolean;
  }>>;
  redeemAtomic(args: { userId: string; rewardItemId: string; redemptionCode: string }): Promise<{
    redemptionId: string; remainingPoints: number; entitlementGranted: boolean;
  }>;
  profile(userId: string): Promise<{
    currentStreak: number; longestStreak: number; lastCheckinDate: string | null;
    freezeCount: number; hasCheckedInToday: boolean; points: number; badges: number;
  }>;
  listStaleStreaks(yesterdayKey: string): Promise<Array<{ userId: string; currentStreak: number; freezeCount: number }>>;
  consumeFreeze(userId: string): Promise<void>;
  resetStreak(userId: string): Promise<void>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toRepo(db: Db): GamificationRepository {
  return {
    async ensureStreak(userId: string): Promise<StreakRow> {
      const row = (await db['userStreak'].upsert({
        where: { userId },
        update: {},
        create: { userId },
      })) as StreakRow;
      return row;
    },

    async saveStreak(userId: string, args: { currentStreak: number; longestStreak: number; lastCheckinDate: Date; freezeUsed: boolean }): Promise<StreakRow> {
      return (await db['userStreak'].update({
        where: { userId },
        data: {
          currentStreak: args.currentStreak,
          longestStreak: args.longestStreak,
          lastCheckinDate: args.lastCheckinDate,
          ...(args.freezeUsed ? { streakFreezeCount: { decrement: 1 } } : {}),
        },
      })) as StreakRow;
    },

    async addFreeze(userId: string, count: number): Promise<number> {
      const row = (await db['userStreak'].update({
        where: { userId },
        data: { streakFreezeCount: { increment: count } },
      }).catch(() => null)) as { streakFreezeCount: number } | null;
      if (row) return row.streakFreezeCount;
      await db['userStreak'].upsert({ where: { userId }, update: {}, create: { userId, streakFreezeCount: 1 + count } });
      return 1 + count;
    },

    async hasCheckin(userId: string, day: Date): Promise<boolean> {
      const row = (await db['dailyCheckin'].findUnique({
        where: { userId_checkinDate: { userId, checkinDate: dayStart(day) } },
      }).catch(() => null)) as unknown;
      return row != null;
    },

    async recordCheckin(args: { userId: string; day: Date; streak: number; points: number; multiplier: number; freezeUsed: boolean }): Promise<void> {
      await db['dailyCheckin'].create({
        data: {
          userId: args.userId,
          checkinDate: dayStart(args.day),
          streakCount: args.streak,
          pointsEarned: args.points,
          bonusMultiplier: args.multiplier,
          isFrozenUsed: args.freezeUsed,
        },
      });
    },

    async addPoints(userId: string, points: number): Promise<number> {
      const row = (await db['user'].update({
        where: { id: userId },
        data: { rewardPoints: { increment: points } },
      })) as { rewardPoints: number };
      return row.rewardPoints;
    },

    async walletPoints(userId: string): Promise<number> {
      const row = (await db['user'].findUnique({ where: { id: userId } }).catch(() => null)) as {
        rewardPoints: number;
      } | null;
      return row?.rewardPoints ?? 0;
    },

    async deductPoints(userId: string, points: number): Promise<number> {
      const row = (await db['user'].update({
        where: { id: userId },
        data: { rewardPoints: { decrement: points } },
      })) as { rewardPoints: number };
      return row.rewardPoints;
    },

    async ensureSeedBadges(): Promise<BadgeRule[]> {
      const existing = (await db['badge'].findMany().catch(() => [])) as Array<BadgeRule & { pointsReward: number }>;
      if (existing.length > 0) return existing;
      const created: BadgeRule[] = [];
      for (const s of SEED_BADGES) {
        try {
          const row = (await db['badge'].create({ data: { ...s } })) as BadgeRule;
          created.push(row);
        } catch {
          // Same-ms double seed → fall through to re-read.
        }
      }
      if (created.length > 0) return created;
      return (await db['badge'].findMany().catch(() => [])) as BadgeRule[];
    },

    async unlockedBadgeIds(userId: string): Promise<Set<string>> {
      const rows = (await db['userBadge'].findMany({ where: { userId } }).catch(() => [])) as Array<{ badgeId: string }>;
      return new Set(rows.map((r) => r.badgeId));
    },

    async unlockBadges(userId: string, rules: BadgeRule[]): Promise<Array<{ id: string; name: string; iconUrl: string }>> {
      const out: Array<{ id: string; name: string; iconUrl: string }> = [];
      for (const r of rules) {
        try {
          await db['userBadge'].create({ data: { userId, badgeId: r.id } });
          await db['user'].update({ where: { id: userId }, data: { rewardPoints: { increment: r.pointsReward } } });
          out.push({ id: r.id, name: r.name, iconUrl: r.iconUrl ?? '' });
        } catch {
          // P2002 replay → already unlocked, skip silently.
        }
      }
      return out;
    },

    async userStats(userId: string): Promise<{ readPages: number; streakDays: number; purchaseCount: number }> {
      const [pages, orders, streak] = (await Promise.all([
        db['ebookReadingProgress'].aggregate({ where: { userId }, _sum: { currentPage: true } }),
        db['order'].count({ where: { userId, orderStatus: 'COMPLETED' } }),
        db['userStreak'].findUnique({ where: { userId } }),
      ]).catch(() => [{ _sum: {} }, 0, null])) as unknown as [
        { _sum: { currentPage: unknown } },
        number,
        { currentStreak: number } | null,
      ];
      const sum = pages._sum.currentPage;
      return {
        readPages: typeof sum === 'number' ? sum : Number((sum as { toString(): string } | null)?.toString?.() ?? 0),
        streakDays: streak?.currentStreak ?? 0,
        purchaseCount: orders ?? 0,
      };
    },

    async catalog() {
      return (await db['rewardItem'].findMany({
        where: { isPublished: true },
        orderBy: { pointsRequired: 'asc' },
      }).catch(() => [])) as Array<{
        id: string; title: string; description: string; imageUrl: string;
        rewardType: string; pointsRequired: number; stockQty: number;
        productId: string | null; isPublished: boolean;
      }>;
    },

    async redeemAtomic(args: { userId: string; rewardItemId: string; redemptionCode: string }): Promise<{
      redemptionId: string; remainingPoints: number; entitlementGranted: boolean;
    }> {
      const user = (await db['user'].findUnique({ where: { id: args.userId } })) as {
        rewardPoints: number;
      };
      const reward = (await db['rewardItem'].findUnique({ where: { id: args.rewardItemId } })) as {
        pointsRequired: number; stockQty: number; isPublished: boolean; productId: string | null;
      } | null;
      if (!reward || !reward.isPublished) throw new Error('REWARD_UNAVAILABLE');
      if (reward.stockQty <= 0) throw new Error('REWARD_OUT_OF_STOCK');
      if (user.rewardPoints < reward.pointsRequired) throw new Error('REWARD_INSUFFICIENT_POINTS');
      const updated = (await db['user'].update({
        where: { id: args.userId },
        data: { rewardPoints: { decrement: reward.pointsRequired } },
      })) as { rewardPoints: number };
      await db['rewardItem'].update({
        where: { id: args.rewardItemId },
        data: { stockQty: { decrement: 1 } },
      });
      const redemption = (await db['rewardRedemption'].create({
        data: {
          redemptionCode: args.redemptionCode,
          userId: args.userId,
          rewardItemId: args.rewardItemId,
          pointsSpent: reward.pointsRequired,
          status: 'COMPLETED',
        },
      })) as { id: string };
      let entitlementGranted = false;
      if (reward.productId) {
        await db['entitlement'].upsert({
          where: { userId_productId: { userId: args.userId, productId: reward.productId } },
          update: {},
          create: { userId: args.userId, productId: reward.productId, accessType: 'FULL_PURCHASE' },
        });
        entitlementGranted = true;
      }
      return { redemptionId: redemption.id, remainingPoints: updated.rewardPoints, entitlementGranted };
    },

    async listStaleStreaks(yesterdayKey: string): Promise<Array<{ userId: string; currentStreak: number; freezeCount: number }>> {
      const rows = (await db['userStreak'].findMany({
        where: {
          currentStreak: { gt: 0 },
          lastCheckinDate: { lt: new Date(`${yesterdayKey}T00:00:00Z`) },
        },
      }).catch(() => [])) as Array<{ userId: string; currentStreak: number; streakFreezeCount: number }>;
      return rows.map((r) => ({ userId: r.userId, currentStreak: r.currentStreak, freezeCount: r.streakFreezeCount }));
    },

    async consumeFreeze(userId: string): Promise<void> {
      await db['userStreak'].update({
        where: { userId },
        data: { streakFreezeCount: { decrement: 1 } },
      });
    },

    async resetStreak(userId: string): Promise<void> {
      await db['userStreak'].update({ where: { userId }, data: { currentStreak: 0 } });
    },

    async profile(userId: string) {      const [streak, points, badges] = (await Promise.all([
        db['userStreak'].findUnique({ where: { userId } }),
        db['user'].findUnique({ where: { id: userId } }),
        db['userBadge'].count({ where: { userId } }),
      ]).catch(() => [null, null, 0])) as unknown as [
        { currentStreak: number; longestStreak: number; lastCheckinDate: Date | null; streakFreezeCount: number } | null,
        { rewardPoints: number } | null,
        number,
      ];
      const today = new Date().toISOString().slice(0, 10);
      const last = streak?.lastCheckinDate ? new Date(streak.lastCheckinDate).toISOString().slice(0, 10) : null;
      return {
        currentStreak: streak?.currentStreak ?? 0,
        longestStreak: streak?.longestStreak ?? 0,
        lastCheckinDate: last,
        freezeCount: streak?.streakFreezeCount ?? 1,
        hasCheckedInToday: last === today,
        points: points?.rewardPoints ?? 0,
        badges: badges ?? 0,
      };
    },
  };
}

@Injectable()
export class PrismaGamificationRepository implements GamificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): GamificationRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): GamificationRepository {
    return toRepo(tx as Db);
  }

  ensureStreak(userId: string) { return this.root.ensureStreak(userId); }
  saveStreak(userId: string, args: { currentStreak: number; longestStreak: number; lastCheckinDate: Date; freezeUsed: boolean }) {
    return this.root.saveStreak(userId, args);
  }
  addFreeze(userId: string, count: number) { return this.root.addFreeze(userId, count); }
  hasCheckin(userId: string, day: Date) { return this.root.hasCheckin(userId, day); }
  recordCheckin(args: { userId: string; day: Date; streak: number; points: number; multiplier: number; freezeUsed: boolean }) {
    return this.root.recordCheckin(args);
  }
  addPoints(userId: string, points: number) { return this.root.addPoints(userId, points); }
  walletPoints(userId: string) { return this.root.walletPoints(userId); }
  deductPoints(userId: string, points: number) { return this.root.deductPoints(userId, points); }
  ensureSeedBadges() { return this.root.ensureSeedBadges(); }
  unlockedBadgeIds(userId: string) { return this.root.unlockedBadgeIds(userId); }
  unlockBadges(userId: string, rules: BadgeRule[]) { return this.root.unlockBadges(userId, rules); }
  userStats(userId: string) { return this.root.userStats(userId); }
  catalog() { return this.root.catalog(); }
  redeemAtomic(args: { userId: string; rewardItemId: string; redemptionCode: string }) {
    return this.root.redeemAtomic(args);
  }
  profile(userId: string) { return this.root.profile(userId); }
  listStaleStreaks(yesterdayKey: string) { return this.root.listStaleStreaks(yesterdayKey); }
  consumeFreeze(userId: string) { return this.root.consumeFreeze(userId); }
  resetStreak(userId: string) { return this.root.resetStreak(userId); }
}
