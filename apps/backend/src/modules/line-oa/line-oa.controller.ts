// SSOT Phase 034 Task 6 — LINE OA REST controller (config + friendship sync)
// Canonical: apps/backend/src/modules/line-oa/line-oa.controller.ts
// (legacy src/backend/modules/line-oa/line-oa.controller.ts)
// - GET  /api/v1/line-oa/config?tenant= — PUBLIC (basicId + prompt mode only,
//   no secrets; middleware bypasses it for logged-out LIFF opens).
// - GET  /api/v1/line-oa/friendship — JWT (own flag, server truth).
// - POST /api/v1/line-oa/friendship/sync { lineUserId?, isOAFriend } — JWT
//   (session subject wins; body lineUserId must match or be absent).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { LineOAService } from './line-oa.service';
import { LineAuthService } from '../auth/line-auth.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string; lineUserId?: string };
}

function actor(req: AuthedReq, bodyLineUserId?: unknown): { userId: string; lineUserId: string | undefined } {
  if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
  if (typeof bodyLineUserId === 'string' && bodyLineUserId && bodyLineUserId !== req.user.lineUserId && bodyLineUserId !== req.user.id) {
    throw new BadRequestException('lineUserId mismatch with session identity');
  }
  return {
    userId: req.user.id,
    lineUserId: typeof bodyLineUserId === 'string' && bodyLineUserId ? bodyLineUserId : req.user.lineUserId,
  };
}

@Controller('api/v1/line-oa')
export class LineOAController {
  constructor(
    private readonly lineOA: LineOAService,
    private readonly lineAuth: LineAuthService,
  ) {}

  @Get('config')
  config(@Query('tenant') tenant: string | undefined) {
    return this.lineOA.publicConfig(tenant || 'default');
  }

  @Get('friendship')
  @UseGuards(JwtAuthGuard)
  friendship(@Req() req: AuthedReq, @Query('lineUserId') lineUserId: string | undefined) {
    const me = actor(req, lineUserId ?? req.user?.lineUserId);
    if (!me.lineUserId) throw new BadRequestException('Missing LINE user id');
    return this.lineAuth.getOAFriendship(me.lineUserId);
  }

  @Post('friendship/sync')
  @UseGuards(JwtAuthGuard)
  sync(@Body() body: Record<string, unknown>, @Req() req: AuthedReq) {
    const me = actor(req, body['lineUserId']);
    if (!me.lineUserId) throw new BadRequestException('Missing LINE user id');
    if (typeof body['isOAFriend'] !== 'boolean') throw new BadRequestException('Invalid friendship flag');
    return this.lineAuth.syncOAFriendship({ lineUserId: me.lineUserId, isOAFriend: body['isOAFriend'] as boolean });
  }
}
