// SSOT Phase 090 §5.1 — Group room entity guards (state machine)
// Canonical: apps/backend/src/modules/group-buying/domain/entities/group-room.entity.ts
// - Legal: WAITING_FOR_MEMBERS → COMPLETED (slot fill) / EXPIRED (24h sweep);
//   any non-COMPLETED → CANCELLED. Join requires WAITING + window + slot free
//   + no self-join (BDD-3 SELF_JOIN_DISALLOWED).
// - Zero new deps.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { canJoin } from '@repo/shared';

export function assertJoinable(
  room: {
    status: string;
    expiresAt: number;
    currentMembersCount: number;
    requiredMembers: number;
    creatorId: string;
    memberUserIds: string[];
  },
  userId: string,
  now = Date.now(),
): void {
  if (room.creatorId === userId || room.memberUserIds.includes(userId)) {
    throw new BadRequestException('SELF_JOIN_DISALLOWED');
  }
  if (room.status === 'COMPLETED') {
    throw new ConflictException('Room is already full');
  }
  if (!canJoin(room, now)) {
    throw new BadRequestException('Room is no longer active or available');
  }
}

export function assertCreatable(isEnabled: boolean): void {
  if (!isEnabled) {
    throw new BadRequestException('Group buying is not enabled for this product');
  }
}
