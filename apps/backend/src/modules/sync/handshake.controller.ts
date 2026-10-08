// SSOT Phase 070 Task 4 — HandshakeController (QR issue/authorize REST)
// Canonical: apps/backend/src/modules/sync/handshake.controller.ts
// (legacy src/backend/modules/sync/handshake.controller.ts)
// - POST /api/v1/sync/handshake/issue { targetRedirectUrl } (JWT desktop).
// - POST /api/v1/sync/handshake/authorize { handshakeToken } (JWT LIFF).
// - GET /api/v1/sync/position?productId=&contentType= (JWT latest state).
// - POST /api/v1/sync/position { ...CrossDeviceSyncPayload } (JWT push).
// - SSE GET /api/v1/sync/cross-device-stream?userId= (room fan-out <500ms).
// - Zero new deps (rxjs + @Sse are existing).
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CROSS_DEVICE_EVENT, crossDeviceChannel } from '@repo/shared';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RedisPubSubAdapter } from '../../infra/redis/redis-pubsub.adapter';
import { CrossDeviceStateService } from './cross-device-state.service';
import { SessionHandshakeService } from '../auth/session-handshake.service';

interface HandshakeReq {
  user?: { id?: string; lineUserId?: string };
  ip?: string;
}

@Controller('api/v1/sync')
export class HandshakeController {
  constructor(
    private readonly state: CrossDeviceStateService,
    private readonly handshake: SessionHandshakeService,
    private readonly rooms?: RedisPubSubAdapter,
  ) {}

  @Post('handshake/issue')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async issue(@Body() body: { targetRedirectUrl?: unknown }, @Req() req: HandshakeReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const res = await this.handshake.issueHandshake(userId, req.user?.lineUserId ?? userId, String(body?.targetRedirectUrl ?? ''));
    if (!res.ok) throw new BadRequestException(res.error ?? 'HANDSHAKE_FAILED');
    return res;
  }

  @Post('handshake/authorize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async authorize(@Body() body: { handshakeToken?: unknown; webSessionId?: unknown }, @Req() req: HandshakeReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const res = await this.handshake.authorizeHandshake(
      userId,
      String(body?.handshakeToken ?? ''),
      String(body?.webSessionId ?? `web-${Date.now().toString(36)}`),
    );
    if (!res.ok) throw new BadRequestException(res.error ?? 'AUTHORIZE_FAILED');
    return res;
  }

  @Get('position')
  @UseGuards(JwtAuthGuard)
  async position(
    @Query('productId') productId: string,
    @Query('contentType') contentType: string,
    @Req() req: HandshakeReq,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    if (!productId || !contentType) throw new BadRequestException('productId and contentType required');
    const latest = await this.state.getLatest(userId, String(productId), String(contentType));
    if (!latest) throw new BadRequestException('NO_SYNC_STATE');
    return latest;
  }

  @Post('position')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async pushPosition(@Body() body: Record<string, unknown>, @Req() req: HandshakeReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const res = await this.state.pushPosition(userId, body ?? {});
    if (!res.ok) throw new BadRequestException(res.error ?? 'SYNC_FAILED');
    return { success: true, resolvedPosition: res.resolvedPosition ?? 0, conflictResolved: res.conflictResolved ?? false };
  }

  /** SSE fan-out: cross-device position events within 500ms (BDD-1/2). */
  @Sse('cross-device-stream')
  crossDeviceStream(@Query('userId') userId: string): Observable<{ data: unknown }> {
    const channel = crossDeviceChannel(String(userId ?? ''));
    return new Observable<{ data: unknown }>((subscriber) => {
      let teardown: (() => void) | null = null;
      let released = false;
      void this.rooms
        ?.subscribeRoom(channel, CROSS_DEVICE_EVENT, (data) => {
          subscriber.next({ data });
        })
        .then((u) => {
          teardown = u;
        })
        .catch(() => undefined);
      return () => {
        if (released) return;
        released = true;
        try {
          teardown?.();
        } catch {
          // unsubscribe best-effort
        }
      };
    });
  }
}
