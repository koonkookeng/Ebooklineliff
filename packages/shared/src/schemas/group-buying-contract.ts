// SSOT Phase 090 §3.1 — Group Buying / Buddy Pass contract
// Canonical: packages/shared/src/schemas/group-buying-contract.ts
// (legacy src/shared/schemas/group-buying-contract.ts — placeholder until now)
// - Spec-verbatim: GroupBuyingStatusEnum / GroupTypeEnum /
//   CreateGroupRoomInputSchema / JoinGroupRoomInputSchema /
//   GroupRoomDetailsSchema (§3.1).
// - RISK_CALL (documented): member orderId is a plain String (payment binds
//   externally via slip flow — avoids Order FK churn; payment core untouched).
//   Room code is human-readable GB-<base36>-<rand4> for Flex + typing.
//   Default TTL 24h (BDD-1 countdown).
// - Pure helpers: required-members, room-code gen, expiry math, join guard,
//   K-factor, invite URL, lock key, stream keys. Zero new deps (zod only).
import { z } from 'zod';

export const GroupBuyingStatusEnum = z.enum([
  'WAITING_FOR_MEMBERS',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
]);
export type GroupBuyingStatus = z.infer<typeof GroupBuyingStatusEnum>;

export const GroupTypeEnum = z.enum([
  'BUDDY_PASS_2P',
  'GROUP_BUY_3P',
  'GROUP_BUY_5P',
  'CORPORATE_TEAM',
]);
export type GroupType = z.infer<typeof GroupTypeEnum>;

export const CreateGroupRoomInputSchema = z.object({
  productId: z.string().uuid(),
  groupType: GroupTypeEnum,
  tenantId: z.string().min(1).optional(),
});
export type CreateGroupRoomInput = z.infer<typeof CreateGroupRoomInputSchema>;

export const JoinGroupRoomInputSchema = z.object({
  roomId: z.string().uuid(),
  slipImageUrl: z.string().url(),
});
export type JoinGroupRoomInput = z.infer<typeof JoinGroupRoomInputSchema>;

export const GroupRoomMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.string().datetime(),
  isCreator: z.boolean(),
});
export type GroupRoomMember = z.infer<typeof GroupRoomMemberSchema>;

export const GroupRoomDetailsSchema = z.object({
  roomId: z.string().uuid(),
  productId: z.string().uuid(),
  productTitle: z.string(),
  coverImageUrl: z.string().url(),
  creatorDisplayName: z.string(),
  creatorAvatarUrl: z.string().nullable(),
  groupType: GroupTypeEnum,
  originalPrice: z.number().positive(),
  discountedPrice: z.number().positive(),
  requiredMembers: z.number().int().min(2),
  currentMembersCount: z.number().int().min(1),
  status: GroupBuyingStatusEnum,
  expiresAt: z.string().datetime(),
  members: z.array(GroupRoomMemberSchema),
});
export type GroupRoomDetails = z.infer<typeof GroupRoomDetailsSchema>;

/** Default room TTL: 24 hours (BDD-1 countdown). */
export const GROUP_DEFAULT_TTL_HOURS = 24;
/** Group-buy event stream (Gate 8, K-factor pipeline). */
export const GROUP_STREAM = 'stream:group-buy:events';

/** Required members per group type (§4.1 defaults). */
export function requiredMembersFor(groupType: string): number {
  switch (groupType) {
    case 'BUDDY_PASS_2P':
      return 2;
    case 'GROUP_BUY_3P':
      return 3;
    case 'GROUP_BUY_5P':
      return 5;
    case 'CORPORATE_TEAM':
      return 5;
    default:
      return 2;
  }
}

/** Human room code: GB-<base36 time>-<rand4> (Flex-friendly). */
export function groupRoomCode(at = Date.now(), rand = Math.floor(Math.random() * 36 ** 4)): string {
  return `GB-${at.toString(36).toUpperCase()}-${rand.toString(36).toUpperCase().padStart(4, '0')}`;
}

/** Expiry instant for a creation time + TTL hours. */
export function groupExpiryAt(createdAt: number, ttlHours = GROUP_DEFAULT_TTL_HOURS): string {
  return new Date(createdAt + ttlHours * 3_600_000).toISOString();
}

/** Join-window guard: WAITING + unexpired + slot free. */
export function canJoin(
  room: { status: string; expiresAt: number; currentMembersCount: number; requiredMembers: number },
  now = Date.now(),
): boolean {
  return (
    room.status === 'WAITING_FOR_MEMBERS' &&
    now < room.expiresAt &&
    room.currentMembersCount < room.requiredMembers
  );
}

/** Viral K-factor: K = invites × conversion (1-decimal, §7.1). */
export function groupKFactor(invitesSent: number, conversionRate: number): number {
  if (invitesSent <= 0 || conversionRate <= 0) return 0;
  return Math.round(invitesSent * conversionRate * 1000) / 1000;
}

/** Invite deep-link into the LIFF group-buy entry. */
export function groupInviteUrl(origin: string, roomId: string): string {
  return `${origin.replace(/\/$/, '')}/group-buy/${roomId}`;
}

/** Redis single-slot mutex key (§8.1 redlock seam). */
export function groupRoomLockKey(roomId: string): string {
  return `lock:group-room:${roomId}`;
}
