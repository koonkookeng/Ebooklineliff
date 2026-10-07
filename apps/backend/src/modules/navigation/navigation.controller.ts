// SSOT Phase 027 §5.2 — Navigation REST controller (Zod-gated, JWT identity)
// Canonical: apps/backend/src/modules/navigation/navigation.controller.ts
// (legacy src/backend/modules/navigation/navigation.controller.ts)
// - POST /api/v1/navigation/sync { userId?, lineUserId, lastPathname, stateSnapshotJson }
// - GET  /api/v1/navigation/restore (identity from JWT; ?userId override for tests)
// - DELETE /api/v1/navigation/session (confirmed-exit cleanup)
// - POST /api/v1/navigation/drop-off (analytics; validated, best-effort publish)
// - Identity: req.user.id wins; body.userId accepted only when it matches the JWT
//   subject or no JWT user is present (LIFF edge header path via LiffSessionGuard).
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { NavigationService } from './navigation.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { LiffSessionGuard } from './guards/liff-session.guard';

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
  if (typeof bodyUserId === 'string' && bodyUserId) return bodyUserId;
  throw new UnauthorizedException('Unauthorized');
}

@Controller('api/v1/navigation')
export class NavigationController {
  constructor(private readonly navigation: NavigationService) {}

  @Post('sync')
  @UseGuards(JwtAuthGuard, LiffSessionGuard)
  syncSession(@Body() body: Record<string, unknown>, @Req() req: AuthedReq) {
    const userId = actor(req, body['userId']);
    return this.navigation.saveSession({ ...(body as object), userId });
  }

  @Get('restore')
  @UseGuards(JwtAuthGuard, LiffSessionGuard)
  restoreSession(@Req() req: AuthedReq, @Query('userId') queryUserId?: string) {
    return this.navigation.getSession(actor(req, queryUserId ?? req.user?.id));
  }

  @Delete('session')
  @UseGuards(JwtAuthGuard, LiffSessionGuard)
  clearSession(@Req() req: AuthedReq, @Query('userId') queryUserId?: string) {
    return this.navigation.clearSession(actor(req, queryUserId ?? req.user?.id));
  }

  @Post('drop-off')
  @UseGuards(LiffSessionGuard)
  dropOff(@Body() body: unknown) {
    return this.navigation.recordDropOff(body);
  }
}
