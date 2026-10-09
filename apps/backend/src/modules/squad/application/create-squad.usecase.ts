// SSOT Phase 096 BDD-1 — Create squad usecase (leader + Flex invite)
// Canonical: apps/backend/src/modules/squad/application/create-squad.usecase.ts
// - Zod gate → entity guards → squad row + LEADER member (Gate 7) → Flex
//   invite card (BDD-1) → stream (Gate 8). Port-based tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSquadInputSchema, SQUAD_STREAM, squadCode, squadInviteUrl } from '@repo/shared';
import { assertSquadCreatable } from '../domain/squad.entity';
import type { SquadRepository } from '../domain/squad.repository.interface';
import { buildSquadInviteFlex } from '../../leaderboard/infrastructure/line/squad-flex.builder';

export interface SquadBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class CreateSquadUsecase {
  constructor(
    private readonly repo: SquadRepository,
    private readonly bus: SquadBus,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async execute(args: {
    leaderId: string;
    tenantId?: string;
    input: { name: string; description?: string; avatarUrl?: string; maxMembers?: number; isPrivate?: boolean };
  }): Promise<{ squadId: string; squadCode: string; flexMessageJson: string; inviteUrl: string }> {
    const parsed = CreateSquadInputSchema.safeParse(args.input);
    if (!parsed.success) throw new BadRequestException('Invalid squad input');
    assertSquadCreatable(parsed.data.name, parsed.data.maxMembers);
    const code = squadCode();
    const row = await this.repo.createSquad({
      tenantId: args.tenantId,
      name: parsed.data.name,
      description: parsed.data.description,
      avatarUrl: parsed.data.avatarUrl,
      squadCode: code,
      maxMembers: parsed.data.maxMembers,
      isPrivate: parsed.data.isPrivate,
      leaderId: args.leaderId,
    });
    const inviteUrl = squadInviteUrl(this.origin, code);
    const flexMessageJson = JSON.stringify(
      buildSquadInviteFlex({ squadName: row.name, totalPoints: 0, inviteUrl }),
    );
    await this.bus
      .xadd(SQUAD_STREAM, {
        event: 'squad_created',
        squadId: row.id,
        leaderId: args.leaderId,
        at: Date.now(),
      })
      .catch(() => undefined);
    return { squadId: row.id, squadCode: code, flexMessageJson, inviteUrl };
  }
}
