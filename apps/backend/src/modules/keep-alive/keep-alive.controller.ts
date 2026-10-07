// SSOT Phase 031 Task 8 — Keep-alive REST controller (JWT-owned sync path)
// Canonical: apps/backend/src/modules/keep-alive/keep-alive.controller.ts
// (legacy src/backend/modules/keep-alive/keep-alive.controller.ts)
// - POST /api/v1/keep-alive/sync { userId?, tenantId?, viewportType, ...branch }
// - GET  /api/v1/keep-alive/state?viewportType= (identity from JWT; row 404s
//   fall back to local IDB on the client — ERROR_FALLBACK toast path).
// - Identity: JWT subject wins; body userId must match or be absent (Phase 027
//   actor precedent — prevents cross-user state overwrite).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { KeepAliveService } from './keep-alive.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq, bodyUserId?: unknown): string {
  if (req.user?.id) {
    if (typeof bodyUserId === 'string' && bodyUserId && bodyUserId !== req.user.id) {
      throw new BadRequestException('userId mismatch with session identity');
    }
    return req.user.id;
  }
  throw new UnauthorizedException('Unauthorized');
}

@Controller('api/v1/keep-alive')
export class KeepAliveController {
  constructor(private readonly states: KeepAliveService) {}

  @Post('sync')
  @UseGuards(JwtAuthGuard)
  sync(@Body() body: Record<string, unknown>, @Req() req: AuthedReq) {
    const userId = actor(req, body['userId']);
    return this.states.syncState({ ...(body as object), userId });
  }

  @Get('state')
  @UseGuards(JwtAuthGuard)
  latest(
    @Req() req: AuthedReq,
    @Query('tenantId') tenantId: string | undefined,
    @Query('viewportType') viewportType: string | undefined,
  ) {
    if (!viewportType) throw new BadRequestException('Missing viewport type');
    const userId = actor(req, undefined);
    return this.states.latestState(userId, tenantId ?? 'default', viewportType);
  }
}
