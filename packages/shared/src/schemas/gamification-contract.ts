// SSOT Phase 083 §3.1 — Gamification, streak, badge & reward contract
// Canonical: packages/shared/src/schemas/gamification-contract.ts
// (legacy src/shared/schemas/gamification-contract.ts — did not exist)
// - Spec-verbatim: BadgeCategoryEnum / RewardTypeEnum /
//   DailyCheckinPayloadSchema / RewardRedemptionInputSchema /
//   RewardRedemptionResultSchema (§3.1).
// - RISK_CALL (documented): squad/group-buy gamification stays in 096
//   (squad-gamification.zod.ts) — this contract owns solo streak/badge/
//   catalog math only (zero overlap).
// - Pure helpers: streak-bonus multiplier (7d→1.5x, 30d→2x), check-in
//   points, UTC day keys, midnight-boundary math, freeze eligibility,
//   redemption-code, catalog availability, stream keys.
// - Zero new deps (zod only).
import { z } from 'zod';

export const BadgeCategoryEnum = z.enum([
  'READING_MILESTONE',
  'LEARNING_STREAK',
  'PURCHASE_COMMUNITY',
  'SOCIAL_AFFILIATE',
  'SPECIAL_EVENT',
]);
export type BadgeCategory = z.infer<typeof BadgeCategoryEnum>;

export const RewardTypeEnum = z.enum([
  'EBOOK_UNLOCK',
  'COURSE_UNLOCK',
  'DISCOUNT_COUPON',
  'PHYSICAL_ITEM',
  'STREAK_FREEZE_ITEM',
]);
export type RewardType = z.infer<typeof RewardTypeEnum>;

export const DailyCheckinPayloadSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  currentStreak: z.number().int().nonnegative(),
  pointsEarned: z.number().int().nonnegative(),
  bonusMultiplier: z.number().positive(),
  nextMilestoneDays: z.number().int().positive(),
  badgeUnlocked: z.object({
    badgeId: z.string().uuid(),
    badgeName: z.string(),
    iconUrl: z.string().url(),
  }).optional().nullable(),
});
export type DailyCheckinPayload = z.infer<typeof DailyCheckinPayloadSchema>;

export const RewardRedemptionInputSchema = z.object({
  rewardItemId: z.string().uuid(),
  shippingAddressId: z.string().uuid().optional(),
});
export type RewardRedemptionInput = z.infer<typeof RewardRedemptionInputSchema>;

export const RewardRedemptionResultSchema = z.object({
  success: z.boolean(),
  redemptionCode: z.string(),
  remainingPoints: z.number().int().nonnegative(),
  entitlementGranted: z.boolean(),
  orderId: z.string().uuid().optional(),
});
export type RewardRedemptionResult = z.infer<typeof RewardRedemptionResultSchema>;

/** Base check-in grant: 10 points (§5.2). */
export const CHECKIN_BASE_POINTS = 10;
/** Streak-freeze starting wallet: 1 item (§4.1). */
export const STREAK_FREEZE_START_COUNT = 1;
/** Freeze shop price in points. */
export const STREAK_FREEZE_PRICE_POINTS = 200;
/** Fraud tripwire: >5 redemptions/min freezes the account (§8.1). */
export const REDEEM_VELOCITY_LIMIT = 5;
export const REDEEM_VELOCITY_WINDOW_SEC = 60;
/** Gamification event stream (Gate 8). */
export const GAMIFICATION_STREAM = 'stream:gamification:events';

/** Bonus multiplier: 30d→2.0x, 7d→1.5x, else 1.0x (§5.2). */
export function streakMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 2.0;
  if (streakDays >= 7) return 1.5;
  return 1.0;
}

/** Points for a streak day (floored): 10 × multiplier. */
export function checkinPoints(streakDays: number): number {
  return Math.floor(CHECKIN_BASE_POINTS * streakMultiplier(streakDays));
}

/** UTC YYYY-MM-DD day key (server-enforced, §8.1 — never client time). */
export function utcDayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Days between two UTC day keys (midnight-boundary safe). */
export function dayGap(lastKey: string | null, todayKey: string): number {
  if (!lastKey) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${lastKey}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Next streak state for a check-in (pure, testable):
 * - gap 0 → duplicate (caller rejects 400);
 * - gap 1 → continue; gap >1 → freeze consumes (if owned) else reset to 1.
 */
export function nextStreak(args: {
  currentStreak: number;
  gapDays: number;
  freezeCount: number;
}): { streak: number; freezeUsed: boolean } {
  if (args.gapDays === 1) return { streak: args.currentStreak + 1, freezeUsed: false };
  if (args.freezeCount > 0 && args.currentStreak >= 1) {
    return { streak: args.currentStreak + 1, freezeUsed: true };
  }
  return { streak: 1, freezeUsed: false };
}

/** Days until the next multiplier milestone (7 or 30). */
export function nextMilestoneDays(streakDays: number): number {
  if (streakDays < 7) return 7 - streakDays;
  if (streakDays < 30) return 30 - streakDays;
  return 1;
}

/** Redemption code: RDM-<base36 time>-<rand>. */
export function redemptionCode(at = Date.now(), rand = Math.floor(Math.random() * 46656)): string {
  return `RDM-${at.toString(36).toUpperCase()}-${rand.toString(36).toUpperCase().padStart(3, '0')}`;
}

/** Catalog availability (published + stock + affordable). */
export function isRewardAvailable(reward: { isPublished: boolean; stockQty: number; pointsRequired: number }, walletPoints: number): boolean {
  return reward.isPublished && reward.stockQty > 0 && walletPoints >= reward.pointsRequired;
}

/** Redis daily check-in idempotency key (24h TTL set by the locker). */
export function checkinDayKey(userId: string, dayKey: string): string {
  return `game:checkin:${userId}:${dayKey}`;
}

/** Redis distributed check-in mutex key (§8.1 Redlock). */
export function checkinLockKey(userId: string): string {
  return `lock:checkin:${userId}`;
}

/** Redis redemption velocity key (§8.1 fraud tripwire). */
export function redeemVelocityKey(userId: string): string {
  return `game:redeem:velocity:${userId}`;
}
