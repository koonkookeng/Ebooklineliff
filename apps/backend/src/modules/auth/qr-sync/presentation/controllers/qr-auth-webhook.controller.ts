// SSOT Phase 007 §5.2 — QR realtime controller (SSE stream + REST scan/confirm/reject/complete)
// Canonical: .../qr-sync/presentation/controllers/qr-auth-webhook.controller.ts
// Transport: SSE over Fastify raw reply (spec permits WebSocket/SSE; zero new deps).
import { Controller, Get, Post, Param, Body, Req, Res, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { InitQrSessionUseCase } from '../../application/use-cases/init-qr-session.use-case';
import { ProcessQrScanUseCase } from '../../application/use-cases/process-qr-scan.use-case';
import { AuthorizeQrSessionUseCase } from '../../application/use-cases/authorize-qr-session.use-case';
import { RedisQrCacheRepository } from '../../infrastructure/repositories/redis-qr-cache.repository';
import { RedisClusterService } from '../../../../../infra/redis/redis-cluster.service';

const SESSION_COOKIE = '__Host-next-auth.session-token';
const REFRESH_COOKIE = '__Host-next-auth.refresh-token';

interface WebReq {
  ip?: string;
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
}

interface WebReply {
  header: (name: string, value: string | string[]) => unknown;
  send: (body: unknown) => unknown;
}

interface RawSseChannel {
  writeHead: (status: number, headers: Record<string, string>) => unknown;
  write: (chunk: string) => unknown;
  end: () => unknown;
  on?: (event: string, cb: () => void) => unknown;
}

interface SseReply {
  raw: RawSseChannel;
}

const TERMINAL = new Set(['AUTHORIZED', 'REJECTED', 'EXPIRED']);

function sseSend(raw: RawSseChannel, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

@Controller('auth/qr')
export class QrAuthWebhookController {
  constructor(
    private readonly initQr: InitQrSessionUseCase,
    private readonly scanQr: ProcessQrScanUseCase,
    private readonly authorizeQr: AuthorizeQrSessionUseCase,
    private readonly cache: RedisQrCacheRepository,
    private readonly redis: RedisClusterService,
  ) {}

  @Post('init')
  async init(@Body() body: { tenantId?: string; desktopIp?: string }, @Req() req: WebReq) {
    const tenantId = body?.tenantId ?? req.headers['x-tenant-id'];
    if (!tenantId) throw new BadRequestException('Missing tenant');
    return this.initQr.init({ desktopIp: body?.desktopIp ?? req.ip ?? null, tenantId });
  }

  @Get(':qrToken/stream')
  async stream(@Param('qrToken') qrToken: string, @Res() reply: SseReply): Promise<void> {
    if (!z.string().uuid().safeParse(qrToken).success) throw new BadRequestException('Invalid QR token');
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const sendState = async () => {
      const state = await this.cache.read(qrToken).catch(() => null);
      sseSend(raw, 'status', state ? { status: state.status, requirePin: !!state.pinHash } : { status: 'EXPIRED' });
      return state?.status ?? 'EXPIRED';
    };
    const initial = await sendState();
    if (TERMINAL.has(initial)) {
      raw.end();
      return;
    }
    const heartbeat = setInterval(() => {
      try {
        raw.write(': ping\n\n');
      } catch {
        // client gone; cleanup below handles it
      }
    }, 15000);
    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = await this.redis.subscribe(`qr:${qrToken}`, (message: string) => {
      try {
        const payload = JSON.parse(message) as { status?: string };
        sseSend(raw, 'status', payload);
        if (payload.status && TERMINAL.has(payload.status)) {
          setTimeout(() => {
            try {
              unsubscribe();
            } catch {
              // already cleaned up
            }
            clearInterval(heartbeat);
            raw.end();
          }, 500);
        }
      } catch {
        // malformed broadcast; ignore
      }
    });
    } catch {
      sseSend(raw, 'status', { status: 'ERROR', errorMessage: 'sync unavailable' });
      clearInterval(heartbeat);
      raw.end();
      return;
    }
    raw.on?.('close', () => {
      clearInterval(heartbeat);
      try {
        unsubscribe();
      } catch {
        // already cleaned up
      }
    });
  }

  @Post(':qrToken/scan')
  async scan(
    @Param('qrToken') qrToken: string,
    @Body() body: { accessToken?: string },
    @Req() req: WebReq,
  ) {
    if (!body?.accessToken) throw new BadRequestException('Missing access token');
    return this.scanQr.scan({ qrToken, accessToken: body.accessToken, mobileIp: req.ip ?? null });
  }

  @Post(':qrToken/confirm')
  async confirm(
    @Param('qrToken') qrToken: string,
    @Body()
    body: { userAccessToken?: string; deviceFingerprint?: string; envelope?: string; pin?: string },
    @Req() req: WebReq,
  ) {
    if (!body?.userAccessToken || !body?.deviceFingerprint) {
      throw new BadRequestException('Missing confirm payload');
    }
    return this.authorizeQr.authorize({
      qrToken,
      userAccessToken: body.userAccessToken,
      deviceFingerprint: body.deviceFingerprint,
      userAgent: req.headers['user-agent'] ?? 'liff-scan',
      ipAddress: req.ip ?? 'unknown',
      envelope: body.envelope,
      pin: body.pin,
    });
  }

  @Post(':qrToken/reject')
  async reject(
    @Param('qrToken') qrToken: string,
    @Body() body: { accessToken?: string },
  ) {
    if (!body?.accessToken) throw new BadRequestException('Missing access token');
    return { rejected: await this.authorizeQr.reject({ qrToken, accessToken: body.accessToken }) };
  }

  @Post(':qrToken/complete')
  async complete(
    @Param('qrToken') qrToken: string,
    @Body() body: { code?: string; deviceFingerprint?: string },
    @Req() req: WebReq,
    @Res() reply: WebReply,
  ): Promise<{ userId: string; tenantId: string }> {
    if (!body?.code || !body?.deviceFingerprint) throw new BadRequestException('Missing handoff payload');
    const result = await this.authorizeQr.complete({
      qrToken,
      code: body.code,
      deviceFingerprint: body.deviceFingerprint,
      ipAddress: req.ip ?? 'unknown',
      userAgent: req.headers['user-agent'] ?? 'desktop-web',
    });
    const cookie = (name: string, value: string, maxAge: number) =>
      `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
    void reply.header('Set-Cookie', [
      cookie(SESSION_COOKIE, result.accessToken, result.expiresIn),
      cookie(REFRESH_COOKIE, result.refreshToken, 7 * 24 * 60 * 60),
    ]);
    return { userId: result.userId, tenantId: result.tenantId };
  }
}
