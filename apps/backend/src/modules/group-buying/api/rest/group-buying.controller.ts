// SSOT Phase 090 — Group-buying REST (creator JWT + public detail)
// Canonical: apps/backend/src/modules/group-buying/api/rest/group-buying.controller.ts
// - POST create (creator JWT) / POST join (member JWT + orderId) /
//   GET detail (public: invite link is the auth) / GET mine (JWT).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { CreateGroupRoomService } from '../../application/services/create-room.service';
import { JoinGroupRoomService } from '../../application/services/join-room.service';
import type { GroupRepository } from '../../domain/repository/group.repository.interface';
import { PrismaGroupRepository } from '../../infrastructure/persistence/prisma-group.repository';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/group-buy')
export class GroupBuyingController {
  constructor(
    private readonly create: CreateGroupRoomService,
    private readonly join: JoinGroupRoomService,
    private readonly repo: PrismaGroupRepository,
  ) {}

  @Post('create')
  @UseGuards(JwtAuthGuard, TenantGuard)
  createRoom(@Req() req: LooseReq, @Body() body: unknown) {
    return this.create.execute({ creatorUserId: actorOf(req), input: (body ?? {}) as never });
  }

  @Post('join')
  @UseGuards(JwtAuthGuard, TenantGuard)
  joinRoom(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { roomId?: string; orderId?: string };
    if (!b.roomId) throw new BadRequestException('Missing roomId');
    if (!b.orderId) throw new BadRequestException('Missing orderId');
    return this.join.execute({ userId: actorOf(req), roomId: b.roomId, orderId: b.orderId });
  }

  @Get('detail')
  async detail(@Query('roomId') roomId: string | undefined) {
    if (!roomId) throw new BadRequestException('Missing roomId');
    const repo: GroupRepository = this.repo;
    const room = await repo.findById(roomId);
    if (!room) throw new BadRequestException('Room not found');
    return {
      roomId: room.id,
      roomCode: room.roomCode,
      productId: room.productId,
      productTitle: room.product.title,
      coverImageUrl: room.product.coverImageUrl,
      groupType: room.groupType,
      originalPrice: room.product.price,
      discountedPrice: room.discountedPrice,
      requiredMembers: room.requiredMembers,
      currentMembersCount: room.currentMembersCount,
      status: room.status,
      expiresAt: new Date(room.expiresAt).toISOString(),
      members: room.members.map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        joinedAt: new Date(m.joinedAt).toISOString(),
        isCreator: m.isCreator,
      })),
    };
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, TenantGuard)
  mine(@Req() req: LooseReq) {
    const repo: GroupRepository = this.repo;
    return repo.userRooms(actorOf(req));
  }
}
