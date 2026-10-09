// SSOT Phase 096 §3.1 — Squad gamification Zod domain contract
// Canonical: packages/shared/src/schemas/squad-gamification.zod.ts
// (spec §1.2 filename verbatim; legacy placeholder until now)
// - Spec-verbatim: SquadMemberRoleEnum / PointActivityTypeEnum /
//   LeaderboardTimeframeEnum / LeaderboardScopeEnum /
//   CreateSquadInputSchema / ClaimPointInputSchema /
//   SquadLeaderboardEntrySchema (§3.1).
// - RISK_CALL (documented): badge models reuse Phase 083 Badge/UserBadge
//   (no duplicate badge tables). Anti-cheat: dwell ≥ 5s + velocity cap +
//   HMAC nonce (replay-proof). Leaderboard keys tenant-scoped.
// - Pure helpers: point table, velocity gate, HMAC nonce, board keys,
//   stream. Zero new deps (node:crypto for HMAC only in helpers? No —
//   HMAC stays backend-side; this file is zod-only).
import { z } from 'zod';

export const SquadMemberRoleEnum = z.enum(['LEADER', 'CO_LEADER', 'MEMBER']);
export type SquadMemberRole = z.infer<typeof SquadMemberRoleEnum>;

export const PointActivityTypeEnum = z.enum([
  'EBOOK_PAGE_READ',
  'LESSON_WATCHED',
  'QUIZ_PASSED',
  'DAILY_CHECKIN',
  'SQUAD_CHALLENGE_COMPLETED',
  'REFERRAL_BONUS',
]);
export type PointActivityType = z.infer<typeof PointActivityTypeEnum>;

export const LeaderboardTimeframeEnum = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME']);
export type LeaderboardTimeframe = z.infer<typeof LeaderboardTimeframeEnum>;

export const LeaderboardScopeEnum = z.enum(['GLOBAL', 'TENANT', 'SQUAD', 'FRIENDS']);
export type LeaderboardScope = z.infer<typeof LeaderboardScopeEnum>;

export const CreateSquadInputSchema = z.object({
  name: z.string().min(3).max(30),
  description: z.string().max(150).optional(),
  avatarUrl: z.string().url().optional(),
  maxMembers: z.number().int().min(2).max(20).default(5),
  isPrivate: z.boolean().default(false),
});
export type CreateSquadInput = z.infer<typeof CreateSquadInputSchema>;

export const ClaimPointInputSchema = z.object({
  activityType: PointActivityTypeEnum,
  referenceId: z.string().uuid(),
  dwellTimeSec: z.number().int().nonnegative(),
  signatureNonce: z.string(),
});
export type ClaimPointInput = z.infer<typeof ClaimPointInputSchema>;

export const SquadLeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  score: z.number(),
  isCurrentSquad: z.boolean().default(false),
});
export type SquadLeaderboardEntry = z.infer<typeof SquadLeaderboardEntrySchema>;

/** Base points per verified activity (multiplier applied separately). */
export const POINT_TABLE: Record<string, number> = {
  EBOOK_PAGE_READ: 5,
  LESSON_WATCHED: 10,
  QUIZ_PASSED: 20,
  DAILY_CHECKIN: 15,
  SQUAD_CHALLENGE_COMPLETED: 50,
  REFERRAL_BONUS: 30,
};

/** Minimum dwell per activity to count (anti-script, §8.1). */
export const MIN_DWELL_SEC = 5;
/** Max claims per user per minute (velocity cap, §8.1). */
export const CLAIM_VELOCITY_LIMIT = 12;
export const CLAIM_VELOCITY_WINDOW_SEC = 60;
/** HMAC nonce TTL: 5 minutes (replay-proof, §8.1). */
export const CLAIM_NONCE_TTL_SEC = 300;
/** Squad/points event stream (Gate 8). */
export const SQUAD_STREAM = 'stream:squad:points';

/** Points for an activity (base × streak multiplier, floored). */
export function pointsFor(activityType: string, multiplier = 1.0): number {
  const base = POINT_TABLE[activityType] ?? 0;
  return Math.max(0, Math.floor(base * Math.max(0, multiplier)));
}

/** Velocity gate: claims within window must stay under the cap. */
export function velocityExceeded(recentClaims: number): boolean {
  return recentClaims >= CLAIM_VELOCITY_LIMIT;
}

/** Redis sorted-set key for a leaderboard slice. */
export function leaderboardKey(scope: string, tenant: string, timeframe: string): string {
  return `leaderboard:${scope.toLowerCase()}:${tenant || 'global'}:${timeframe.toLowerCase()}`;
}

/** Squad invite deep-link code URL. */
export function squadInviteUrl(origin: string, squadCode: string): string {
  return `${origin.replace(/\/$/, '')}/squads/join?code=${encodeURIComponent(squadCode)}`;
}

/** Human squad code: SQD-<base36>-<rand4> (Flex-friendly). */
export function squadCode(at = Date.now(), rand = Math.floor(Math.random() * 36 ** 4)): string {
  return `SQD-${at.toString(36).toUpperCase()}-${rand.toString(36).toUpperCase().padStart(4, '0')}`;
}
