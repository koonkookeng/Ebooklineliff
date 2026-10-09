// SSOT Phase 096 — Squad REST (creator/member JWT)
// Canonical: apps/backend/src/modules/squad/squad.controller.ts
// - POST create / POST join / POST leave / GET mine. Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreateSquadUsecase } from './application/create-squad.usecase';
import { JoinSquadUsecase, LeaveSquadUsecase } from './application/join-squad.usecase';
import type { SquadRepository } from './domain/squad.repository.interface';
import { PrismaSquadRepository } from './infrastructure/persistence/prisma-squad.repository';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { userId: string; tenantId: string } {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const tenantId = ((req as { tenantId?: string }).tenantId ?? '').trim() || 'default';
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { userId: user.id, tenantId };
}

@Controller('api/v1/squads')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SquadController {
  constructor(
    private readonly create: CreateSquadUsecase,
    private readonly join: JoinSquadUsecase,
    private readonly leave: LeaveSquadUsecase,
    private readonly repo: PrismaSquadRepository,
  ) {}

  @Post('create')
  createSquad(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, tenantId } = actorOf(req);
    return this.create.execute({ leaderId: userId, tenantId, input: (body ?? {}) as never });
  }

  @Post('join')
  joinSquad(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { squadCode?: string; squadId?: string };
    return this.join.execute({ userId: actorOf(req).userId, squadCode: b.squadCode, squadId: b.squadId });
  }

  @Post('leave')
  leaveSquad(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { squadId?: string };
    if (!b.squadId) throw new BadRequestException('Missing squadId');
    return this.leave.execute({ userId: actorOf(req).userId, squadId: b.squadId });
  }

  @Get('mine')
  mine(@Req() req: LooseReq) {
    const repo: SquadRepository = this.repo;
    return repo.userSquads(actorOf(req).userId);
  }

  @Get('detail')
  async detail(@Query('squadId') squadId: string | undefined) {
    if (!squadId) throw new BadRequestException('Missing squadId');
    const repo: SquadRepository = this.repo;
    const room = await repo.findById(squadId);
    if (!room) throw new BadRequestException('Squad not found');
    return room;
  }
}
