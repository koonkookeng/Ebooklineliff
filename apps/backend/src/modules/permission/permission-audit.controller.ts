// SSOT Phase 032 Task 2 — Permission REST controller (audit + geocode routes)
// Canonical: apps/backend/src/modules/permission/permission-audit.controller.ts
// (legacy src/backend/modules/permission/permission-audit.controller.ts)
// - POST /api/v1/permission/audit { permissionType, status, ... } (JWT identity
//   wins; body userId must match or be absent — Phase 027 actor precedent).
// - GET  /api/v1/permission/audit (own trail, JWT).
// - GET  /api/v1/permission/reverse-geocode?lat=&lng= (JWT; 800ms budget,
//   503 when no provider is configured — cache hits still serve).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { PermissionAuditService } from './permission-audit.service';
import { ReverseGeocodingService } from './reverse-geocoding.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
  headers?: Record<string, string | string[] | undefined>;
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

function header(headers: AuthedReq['headers'], name: string): string | undefined {
  const v = headers?.[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

@Controller('api/v1/permission')
export class PermissionAuditController {
  constructor(
    private readonly audits: PermissionAuditService,
    private readonly geocoding: ReverseGeocodingService,
  ) {}

  @Post('audit')
  @UseGuards(JwtAuthGuard)
  audit(@Body() body: Record<string, unknown>, @Req() req: AuthedReq) {
    const userId = actor(req, body['userId']);
    const forwarded = header(req.headers, 'x-forwarded-for');
    return this.audits.logAudit({
      ...(body as object),
      userId,
      ipAddress: forwarded?.split(',')[0].trim() || 'unknown',
      userAgent: (header(req.headers, 'user-agent') || 'Unknown').slice(0, 500),
      requestedAt: new Date().toISOString(),
    });
  }

  @Get('audit')
  @UseGuards(JwtAuthGuard)
  myTrail(@Req() req: AuthedReq) {
    return this.audits.myLogs(actor(req, undefined));
  }

  @Get('reverse-geocode')
  @UseGuards(JwtAuthGuard)
  reverseGeocode(
    @Req() req: AuthedReq,
    @Query('lat') lat: string | undefined,
    @Query('lng') lng: string | undefined,
  ) {
    const userId = actor(req, undefined);
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('Invalid coordinates');
    }
    return this.geocoding.getAddressFromCoords(userId, latitude, longitude);
  }
}
