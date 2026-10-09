// SSOT Phase 090 BDD-1 — Create group room service (WAITING + Flex invite)
// Canonical: apps/backend/src/modules/group-buying/application/services/create-room.service.ts
// - Flow: Zod gate -> config enabled -> price/TTL resolve -> WAITING room +
//   creator member (orderId = pending:<roomId>:<userId>, slip binds later) ->
//   Flex invite + claim URL -> GROUP_ROOM_CREATED stream.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateGroupRoomInputSchema,
  GROUP_STREAM,
  groupExpiryAt,
  groupInviteUrl,
  groupRoomCode,
  requiredMembersFor,
} from '@repo/shared';
import { GROUP_ROOM_CREATED_EVENT } from '../../domain/events/group.events';
import { assertCreatable } from '../../domain/entities/group-room.entity';
import type { GroupRepository } from '../../domain/repository/group.repository.interface';
import { LineFlexGroupBuilder } from '../../infrastructure/line/line-flex-group.builder';

export interface GroupBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

function priceFor(
  config: { buddyPassPrice: number; groupBuy3pPrice: number | null; groupBuy5pPrice: number | null },
  groupType: string,
): number {
  if (groupType === 'GROUP_BUY_3P') return config.groupBuy3pPrice ?? config.buddyPassPrice;
  if (groupType === 'GROUP_BUY_5P' || groupType === 'CORPORATE_TEAM') {
    return config.groupBuy5pPrice ?? config.buddyPassPrice;
  }
  return config.buddyPassPrice;
}

@Injectable()
export class CreateGroupRoomService {
  constructor(
    private readonly repo: GroupRepository,
    private readonly flex: LineFlexGroupBuilder,
    private readonly bus: GroupBus,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async execute(args: {
    creatorUserId: string;
    input: { productId: string; groupType: string };
  }): Promise<{
    roomId: string;
    roomCode: string;
    flexMessageJson: string;
    inviteUrl: string;
    expiresAt: string;
    discountedPrice: number;
  }> {
    const parsed = CreateGroupRoomInputSchema.safeParse({ ...args.input, tenantId: 'default' });
    if (!parsed.success) throw new BadRequestException('Invalid group room input');
    const product = await this.repo.findProduct(parsed.data.productId);
    if (!product) throw new NotFoundException('Product not found');
    const config = await this.repo.findConfig(parsed.data.productId);
    if (!config) throw new NotFoundException('Group buying is not configured for this product');
    assertCreatable(config.isEnabled);

    const now = Date.now();
    const requiredMembers = requiredMembersFor(parsed.data.groupType);
    const discountedPrice = priceFor(config, parsed.data.groupType);
    const roomCode = groupRoomCode(now);
    const expiresAt = groupExpiryAt(now, config.timeLimitHours);

    const room = await this.repo.createRoom({
      productId: product.id,
      creatorId: args.creatorUserId,
      groupType: parsed.data.groupType,
      requiredMembers,
      discountedPrice,
      roomCode,
      expiresAt: new Date(expiresAt),
    });
    await this.repo.addMember({
      roomId: room.id,
      userId: args.creatorUserId,
      orderId: `pending:${room.id}:${args.creatorUserId}`,
      isCreator: true,
    });

    const inviteUrl = groupInviteUrl(this.origin, room.id);
    const { flexMessageJson } = this.flex.build({
      productTitle: product.title,
      coverImageUrl: product.coverImageUrl,
      groupType: parsed.data.groupType,
      discountedPrice,
      originalPrice: product.price,
      currentMembers: 1,
      requiredMembers,
      inviteUrl,
    });

    await this.bus
      .xadd(GROUP_STREAM, {
        event: GROUP_ROOM_CREATED_EVENT,
        roomId: room.id,
        roomCode,
        creatorId: args.creatorUserId,
        productId: product.id,
        groupType: parsed.data.groupType,
        at: now,
      })
      .catch(() => undefined);
    return { roomId: room.id, roomCode, flexMessageJson, inviteUrl, expiresAt, discountedPrice };
  }
}
