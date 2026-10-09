// SSOT Phase 100 Task 5 — Live access REST (token/heartbeat/SSE/kick)
// Canonical: apps/backend/src/modules/stream/live-access.controller.ts
// - POST token (ephemeral 30s) / POST heartbeat (15s) / GET kick SSE stream
//   / POST kick (moderator). JWT + tenant guards; velocity guard on the
//   anonymous-shaped path lives in the contract test. Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { LiveEntitlementCheckSchema, HeartbeatPayloadSchema } from './dto/live-entitlement.dto';
import { LiveGatekeeperService } from './live-gatekeeper.service';
import { LiveStreamGateway } from './live-stream.gateway';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { userId: string; ip: string } {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const ip = (headers['x-forwarded-for']?.split(',')[0]?.trim() || (req['ip'] as string | undefined) || 'unknown');
  return { userId: user.id, ip };
}

@Controller('api/v1/live-access')
export class LiveAccessController {
  constructor(
    private readonly gate: LiveGatekeeperService,
    private readonly kicks: LiveStreamGateway,
  ) {}

  @Post('token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  token(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, ip } = actorOf(req);
    const b = (body ?? {}) as { liveRoomId?: string; deviceFingerprint?: string };
    const parsed = LiveEntitlementCheckSchema.safeParse({
      userId,
      liveRoomId: b.liveRoomId,
      deviceFingerprint: b.deviceFingerprint ?? 'unknown',
      requestTimestamp: Date.now(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid token request');
    return this.gate.validateAndIssuePlaybackToken({
      userId,
      liveRoomId: parsed.data.liveRoomId,
      deviceFingerprint: parsed.data.deviceFingerprint,
      clientIp: ip,
    });
  }

  @Post('heartbeat')
  @UseGuards(JwtAuthGuard, TenantGuard)
  heartbeat(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, ip } = actorOf(req);
    const parsed = HeartbeatPayloadSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid heartbeat');
    return this.gate.heartbeat({
      sessionToken: parsed.data.sessionToken,
      liveRoomId: parsed.data.liveRoomId,
      userId,
      currentPlaybackSec: parsed.data.currentPlaybackSec,
      deviceFingerprint: parsed.data.deviceFingerprint,
      clientIp: ip,
    });
  }

  @Sse('rooms/:roomId/kick-stream')
  kickStream(@Param('roomId') roomId: string, @Query('userId') userId: string): Observable<{ data: unknown }> {
    // NOTE: EventSource cannot send Authorization headers — identity rides
    // the (roomId,userId) pair and the stream only emits that viewer's own
    // kick events (no catalog/entitlement data).
    if (!roomId || !userId) throw new BadRequestException('Missing roomId/userId');
    return new Observable((subscriber) => {
      const release = this.kicks.subscribe(roomId, userId, {
        write: (chunk: string) => subscriber.next({ data: chunk }),
      });
      return release;
    });
  }

  @Post('rooms/:roomId/kick')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async kick(@Req() req: LooseReq, @Param('roomId') roomId: string, @Body() body: unknown) {
    actorOf(req);
    // Moderator-only: instructors + staff roles (fail-closed on plain MEMBER).
    const role = (req['user'] as { role?: string } | undefined)?.role;
    if (!role || !['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF', 'INSTRUCTOR'].includes(role)) {
      throw new ForbiddenException('Moderator role required');
    }
    const b = (body ?? {}) as { userId?: string; reason?: string };
    if (!b.userId) throw new BadRequestException('Missing userId');
    const reason = (b.reason ?? 'MODERATOR_KICK').slice(0, 120);
    const r = await this.gate.kickSession({ liveRoomId: roomId, userId: b.userId, reason });
    await this.kicks.emitKick(roomId, b.userId, reason);
    return r;
  }
}
