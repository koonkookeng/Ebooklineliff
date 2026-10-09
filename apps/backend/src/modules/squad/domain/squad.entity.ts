// SSOT Phase 096 §5.1 — Squad entity guards (capacity + privacy + roles)
// Canonical: apps/backend/src/modules/squad/domain/squad.entity.ts
// - Private squads join by code only; public squads join by id. Leaders
//   cannot leave without transfer (simplified: leader leave disbands when
//   last member). Zero new deps.
import { BadRequestException, ConflictException } from '@nestjs/common';

export function assertSquadCreatable(name: string, maxMembers: number): void {
  if (name.trim().length < 3 || name.length > 30) {
    throw new BadRequestException('Squad name must be 3-30 chars');
  }
  if (maxMembers < 2 || maxMembers > 20) {
    throw new BadRequestException('maxMembers must be 2-20');
  }
}

export function assertJoinable(args: {
  memberCount: number;
  maxMembers: number;
  memberIds: string[];
  userId: string;
}): void {
  if (args.memberIds.includes(args.userId)) {
    throw new ConflictException('Already a squad member');
  }
  if (args.memberCount >= args.maxMembers) {
    throw new ConflictException('Squad is full');
  }
}
