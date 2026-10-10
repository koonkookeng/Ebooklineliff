// SSOT Phase 119 Task 4 §5.1 — device security REST (handshake/heartbeat)
// Canonical: apps/backend/src/modules/security/controllers/security-fingerprint.controller.ts
// (legacy src/backend/modules/security/controllers/security-fingerprint.controller.ts)
// - POST handshake (fingerprint register + session open, atomic Gate 7) /
//   POST heartbeat (takeover + SSE signal) / GET devices (list + revoke) /
//   POST revoke-device / GET stream-key (device-bound ticket; the AES-128
//   segment key itself stays in the 050 lane). JWT-guarded. Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { FingerprintVerifierService } from '../services/fingerprint-verifier.service';
import { SessionEvictionService } from '../services/session-eviction.service';
import { HlsTokenSignerService } from '../services/hls-token-signer.service';
import { ActiveSessionRedisRepository } from '../repositories/active-session-redis.repository';
import { interval, switchMap } from 'rxjs';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function ipOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0');
}

@Controller('api/v1/security/device')
export class SecurityFingerprintController {
  constructor(
    private readonly verifier: FingerprintVerifierService,
    private readonly sessions: SessionEvictionService,
    private readonly tickets: HlsTokenSignerService,
    private readonly edge: ActiveSessionRedisRepository,
  ) {}

  @Post('handshake')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async handshake(@Req() req: LooseReq, @Body() body: unknown) {
    const userId = actorOf(req);
    const b = (body ?? {}) as { fingerprint?: unknown; lessonId?: string; deviceName?: string };
    if (!b.lessonId) throw new BadRequestException('Missing lessonId');
    const bound = await this.verifier.verifyAndBind(userId, b.fingerprint ?? body, { ipAddress: ipOf(req), deviceName: b.deviceName });
    if (bound.fraud.verdict === 'LOCK') {
      await this.sessions.lockAccount(userId, bound.fingerprintHash, ipOf(req), bound.fraud.score);
      throw new BadRequestException('Suspicious device activity — account locked, re-authenticate via OTP');
    }
    const session = await this.sessions.openSession(userId, bound.deviceId, b.lessonId, ipOf(req));
    return { ...bound, ...session };
  }

  @Post('heartbeat')
  @UseGuards(JwtAuthGuard, TenantGuard)
  heartbeat(@Req() req: LooseReq, @Body() body: unknown) {
    const userId = actorOf(req);
    const b = (body ?? {}) as { lessonId?: string; sessionToken?: string; fingerprintHash?: string; playbackPositionSec?: number };
    if (!b.lessonId || !b.sessionToken || !b.fingerprintHash) {
      throw new BadRequestException('Security Context Missing');
    }
    return this.sessions.heartbeat({
      userId,
      sessionToken: b.sessionToken,
      fingerprintHash: b.fingerprintHash,
      lessonId: b.lessonId,
      playbackPositionSec: b.playbackPositionSec ?? 0,
      ipAddress: ipOf(req),
    });
  }

  @Get('stream-key')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async streamKey(@Req() req: LooseReq, @Query('sessionToken') sessionToken: string | undefined, @Query('lessonId') lessonId: string | undefined) {
    const userId = actorOf(req);
    if (!sessionToken || !lessonId) throw new BadRequestException('Missing sessionToken/lessonId');
    const pointer = await this.edge.read(userId);
    if (!pointer || pointer.sessionToken !== sessionToken) {
      throw new BadRequestException('Session evicted or expired — key exchange denied');
    }
    return this.tickets.mint({ sessionToken, fingerprintHash: pointer.fingerprintHash, lessonId });
  }

  @Post('evict-other')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async evictOther(@Req() req: LooseReq) {
    const userId = actorOf(req);
    return this.sessions.revokeAll(userId, 'USER_KICK');
  }

  /**
   * SSE eviction feed (?sessionToken=): polls the edge pointer every 3s
   * (20 rounds ≈ 60s cap) and emits `device.evicted` the moment the pointer
   * no longer belongs to the caller. The 5s heartbeat stays the primary
   * detector; this feed shortens modal latency toward the 150ms budget.
   */
  @Sse('events')
  @UseGuards(JwtAuthGuard, TenantGuard)
  events(@Req() req: LooseReq, @Query('sessionToken') sessionToken: string | undefined) {
    const userId = actorOf(req);
    if (!sessionToken) throw new BadRequestException('Missing sessionToken');
    let rounds = 0;
    return interval(3000).pipe(
      switchMap(async () => {
        rounds++;
        const pointer = await this.edge.read(userId);
        if (!pointer || pointer.sessionToken !== sessionToken) {
          return { data: { type: 'device.evicted', evictedDeviceId: pointer?.deviceId ?? null } };
        }
        if (rounds >= 20) {
          return { data: { type: 'device.events.end' } };
        }
        return { data: { type: 'device.heartbeat', ok: true } };
      }),
    );
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard, TenantGuard)
  devices(@Req() req: LooseReq) {
    return this.sessions.listDevices(actorOf(req));
  }

  @Post('revoke-device')
  @UseGuards(JwtAuthGuard, TenantGuard)
  revokeDevice(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { deviceId?: string };
    if (!b.deviceId) throw new BadRequestException('Missing deviceId');
    return this.sessions.revokeDevice(actorOf(req), b.deviceId);
  }
}
