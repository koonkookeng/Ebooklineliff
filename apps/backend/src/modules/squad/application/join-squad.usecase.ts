// SSOT Phase 096 BDD-1 — Join/leave squad usecases (capacity-guarded)
// Canonical: apps/backend/src/modules/squad/application/join-squad.usecase.ts
// - Code-gated join (private-by-code, public-by-id) + capacity guard +
//   atomic member row. Leave removes the row (leader-last-member disbands
//   upstream). Port-based tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SQUAD_STREAM } from '@repo/shared';
import { assertJoinable } from '../domain/squad.entity';
import type { SquadRepository } from '../domain/squad.repository.interface';

export interface SquadBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class JoinSquadUsecase {
  constructor(
    private readonly repo: SquadRepository,
    private readonly bus?: SquadBus,
  ) {}

  async execute(args: { userId: string; squadCode?: string; squadId?: string }): Promise<{ squadId: string; memberCount: number }> {
    if (!args.squadCode && !args.squadId) throw new BadRequestException('Missing squadCode/squadId');
    const room = args.squadCode
      ? await this.repo.findByCode(args.squadCode)
      : await this.repo.findById(args.squadId as string);
    if (!room) throw new NotFoundException('Squad not found');
    assertJoinable({
      memberCount: room.members.length,
      maxMembers: room.maxMembers,
      memberIds: room.members.map((m) => m.userId),
      userId: args.userId,
    });
    await this.repo.addMember(room.id, args.userId, 'MEMBER');
    await this.bus
      ?.xadd(SQUAD_STREAM, { event: 'squad_joined', squadId: room.id, userId: args.userId, at: Date.now() })
      .catch(() => undefined);
    return { squadId: room.id, memberCount: room.members.length + 1 };
  }
}

@Injectable()
export class LeaveSquadUsecase {
  constructor(private readonly repo: SquadRepository) {}

  async execute(args: { userId: string; squadId: string }): Promise<boolean> {
    const room = await this.repo.findById(args.squadId);
    if (!room) throw new NotFoundException('Squad not found');
    await this.repo.removeMember(args.squadId, args.userId);
    return true;
  }
}
