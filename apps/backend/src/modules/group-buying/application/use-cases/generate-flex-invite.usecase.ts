// SSOT Phase 090 Task 5 — Generate invite card use-case (re-share intake)
// Canonical: apps/backend/src/modules/group-buying/application/use-cases/generate-flex-invite.usecase.ts
// - Rebuilds the Flex invite for an existing WAITING room (re-share flow).
// - Zero new deps.
import { Injectable, NotFoundException } from '@nestjs/common';
import { groupInviteUrl } from '@repo/shared';
import type { GroupRepository } from '../../domain/repository/group.repository.interface';
import { LineFlexGroupBuilder } from '../../infrastructure/line/line-flex-group.builder';

@Injectable()
export class GenerateFlexInviteUseCase {
  constructor(
    private readonly repo: GroupRepository,
    private readonly flex: LineFlexGroupBuilder,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async execute(roomId: string): Promise<{ inviteUrl: string; flexMessageJson: string }> {
    const room = await this.repo.findById(roomId);
    if (!room) throw new NotFoundException('Group room not found');
    const inviteUrl = groupInviteUrl(this.origin, room.id);
    const { flexMessageJson } = this.flex.build({
      productTitle: room.product.title,
      coverImageUrl: room.product.coverImageUrl,
      groupType: room.groupType,
      discountedPrice: room.discountedPrice,
      originalPrice: room.product.price,
      currentMembers: room.currentMembersCount,
      requiredMembers: room.requiredMembers,
      inviteUrl,
    });
    return { inviteUrl, flexMessageJson };
  }
}
