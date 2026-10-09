// SSOT Phase 090 Task 2 — Group-buying GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/group-buying/api/graphql/group-buying.resolver.ts
// - Mutation.createGroupBuyingRoom / joinGroupBuyingRoom /
//   cancelGroupBuyingRoom. Query.getGroupRoomDetails /
//   getActiveUserGroupRooms / groupKFactor.
// - Zero new deps.
import { Args, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { groupKFactor } from '@repo/shared';
import { CreateGroupRoomService } from '../../application/services/create-room.service';
import { JoinGroupRoomService } from '../../application/services/join-room.service';
import type { GroupRepository } from '../../domain/repository/group.repository.interface';
import { PrismaGroupRepository } from '../../infrastructure/persistence/prisma-group.repository';
import {
  CreateGroupRoomPayloadGql,
  GroupKFactorGql,
  GroupRoomDetailsGql,
  JoinGroupRoomResultGql,
} from './group-buying.type';

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string | null } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  return { userId: user.id ?? null };
}

function actorOf(ctx: LooseCtx): string {
  const { userId } = ctxOf(ctx);
  if (!userId) throw new BadRequestException('Missing authentication');
  return userId;
}

function detailOf(room: {
  id: string; productId: string; groupType: string;
  requiredMembers: number; currentMembersCount: number; discountedPrice: number;
  status: string; expiresAt: Date; creatorId: string;
  product: { title: string; coverImageUrl: string; price: number };
  members: Array<{
    userId: string; isCreator: boolean; joinedAt: Date;
    user: { displayName: string; avatarUrl: string | null };
  }>;
}): GroupRoomDetailsGql {
  const out = new GroupRoomDetailsGql();
  const creator = room.members.find((m) => m.isCreator);
  out.roomId = room.id;
  out.productId = room.productId;
  out.productTitle = room.product.title;
  out.coverImageUrl = room.product.coverImageUrl;
  out.creatorDisplayName = creator?.user.displayName ?? 'ผู้สร้างห้อง';
  out.creatorAvatarUrl = creator?.user.avatarUrl ?? null;
  out.groupType = room.groupType;
  out.originalPrice = room.product.price;
  out.discountedPrice = room.discountedPrice;
  out.requiredMembers = room.requiredMembers;
  out.currentMembersCount = room.currentMembersCount;
  out.status = room.status;
  out.expiresAt = new Date(room.expiresAt).toISOString();
  out.members = room.members.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    avatarUrl: m.user.avatarUrl,
    joinedAt: new Date(m.joinedAt).toISOString(),
    isCreator: m.isCreator,
  }));
  return out;
}

@Resolver('GroupBuying')
export class GroupBuyingResolver {
  constructor(
    private readonly create: CreateGroupRoomService,
    private readonly join: JoinGroupRoomService,
    private readonly repo: PrismaGroupRepository,
  ) {}

  @Mutation('createGroupBuyingRoom')
  createGroupBuyingRoom(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    return this.create.execute({ creatorUserId: actorOf(ctx), input: input as never });
  }

  @Mutation('joinGroupBuyingRoom')
  joinGroupBuyingRoom(
    @Args('roomId') roomId: string,
    @Args('orderId') orderId: string,
    @Context() ctx: LooseCtx,
  ) {
    return this.join.execute({ userId: actorOf(ctx), roomId, orderId });
  }

  @Mutation('cancelGroupBuyingRoom')
  async cancelGroupBuyingRoom(@Args('roomId') roomId: string, @Context() ctx: LooseCtx): Promise<boolean> {
    const repo: GroupRepository = this.repo;
    const room = await repo.findById(roomId);
    if (!room || room.creatorId !== actorOf(ctx)) throw new BadRequestException('Room not found');
    if (room.status !== 'WAITING_FOR_MEMBERS') throw new BadRequestException('Only waiting rooms can be cancelled');
    await repo.markCancelled(roomId);
    return true;
  }

  @Query('getGroupRoomDetails')
  async getGroupRoomDetails(@Args('roomId') roomId: string) {
    const repo: GroupRepository = this.repo;
    const room = await repo.findById(roomId);
    return room ? detailOf(room) : null;
  }

  @Query('getActiveUserGroupRooms')
  async getActiveUserGroupRooms(@Context() ctx: LooseCtx) {
    const repo: GroupRepository = this.repo;
    const rows = await repo.userRooms(actorOf(ctx));
    const out: GroupRoomDetailsGql[] = [];
    for (const r of rows) {
      const full = await repo.findById(r.id);
      if (full && full.status === 'WAITING_FOR_MEMBERS') out.push(detailOf(full));
    }
    return out;
  }

  @Query('groupKFactor')
  async groupKFactor(@Args('invitesSent') invitesSent: number, @Args('conversionRate') conversionRate: number) {
    const out = new GroupKFactorGql();
    out.invitesSent = invitesSent;
    out.conversionRate = conversionRate;
    out.kFactor = groupKFactor(invitesSent, conversionRate);
    return out;
  }
}

// Re-export payload/result types for module consumers.
export { CreateGroupRoomPayloadGql, JoinGroupRoomResultGql };
