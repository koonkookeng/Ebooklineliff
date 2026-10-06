// SSOT Phase 007 §5.1/BDD — authorize (HMAC envelope + risk/PIN + single-use) / reject / complete
// Canonical: .../qr-sync/application/use-cases/authorize-qr-session.use-case.ts
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfirmQrAuthPayloadSchema } from '@repo/shared';
import { PrismaService } from '../../../../../infra/database/prisma.service';
import { TokenService } from '../../../services/token.service';
import { RedisQrCacheRepository } from '../../infrastructure/repositories/redis-qr-cache.repository';
import { QrAuthGateway } from '../../infrastructure/gateways/qr-auth.gateway';
import { scoreQrRisk, requiresPin, QR_TTL_SEC } from '../../domain/entities/qr-session.entity';
import { openEnvelope, generatePin, hashPin, hashNonce } from '../../domain/value-objects/ephemeral-nonce.vo';

const MAX_ATTEMPTS = 5;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

@Injectable()
export class AuthorizeQrSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisQrCacheRepository,
    private readonly tokens: TokenService,
    private readonly gateway: QrAuthGateway,
  ) {}

  async authorize(raw: {
    qrToken: string;
    userAccessToken: string;
    deviceFingerprint: string;
    userAgent: string;
    ipAddress: string;
    envelope?: string;
    pin?: string;
  }): Promise<{ success: boolean; authorizedAt: string; deviceInfo: string; requirePin?: boolean }> {
    const parsed = ConfirmQrAuthPayloadSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid QR confirm payload');
    const input = parsed.data;

    let userId: string;
    try {
      userId = this.tokens.verifyAccessToken(input.userAccessToken).sub;
    } catch {
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }

    const state = await this.cache.read(input.qrToken);
    if (!state) throw new BadRequestException('QR_SESSION_EXPIRED');
    if (state.status !== 'PENDING' && state.status !== 'SCANNED') {
      throw new BadRequestException(`QR_INVALID_STATE:${state.status}`);
    }
    if (state.attempts >= MAX_ATTEMPTS) {
      await this.toRejected(input.qrToken, state.tenantId, 'TOO_MANY_ATTEMPTS').catch(() => undefined);
      throw new BadRequestException('QR_TOO_MANY_ATTEMPTS');
    }

    // Envelope integrity when the LIFF client presents it (QR deep-link carries it)
    if (input.envelope) {
      try {
        openEnvelope(input.envelope, input.qrToken);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : 'INVALID_QR_ENVELOPE');
      }
    }

    const known = await this.prisma.userDeviceSession
      .findFirst({ where: { userId, deviceFingerprint: input.deviceFingerprint } })
      .catch(() => null);
    const riskScore = scoreQrRisk({
      desktopIp: state.desktopIp,
      mobileIp: input.ipAddress,
      fingerprintKnown: !!known,
      attempts: state.attempts,
    });

    if (requiresPin(riskScore)) {
      if (!input.pin) {
        // Issue step-up PIN once. The PIN travels ONLY on the desktop SSE channel
        // (possession proof of both devices); it is never returned to the LIFF caller.
        let pinHash = state.pinHash;
        let pinDisplay: string | undefined;
        if (!pinHash) {
          pinDisplay = generatePin();
          pinHash = hashPin(pinDisplay);
        }
        await this.cache.write(input.qrToken, { ...state, pinHash, riskScore, attempts: state.attempts + 1 });
        await this.gateway
          .broadcast(input.qrToken, { status: 'SCANNED', requirePin: true, pinDisplay })
          .catch(() => undefined);
        await this.prisma.authAuditLog
          .create({
            data: { userId, tenantId: state.tenantId, event: 'QR_PIN_REQUIRED', ipAddress: input.ipAddress, userAgent: input.userAgent, metadata: { qrToken: input.qrToken, riskScore } },
          })
          .catch(() => undefined);
        return { success: false, authorizedAt: new Date().toISOString(), deviceInfo: input.deviceFingerprint, requirePin: true };
      }
      if (!state.pinHash || !safeEqualHex(hashPin(input.pin), state.pinHash)) {
        await this.cache.write(input.qrToken, { ...state, attempts: state.attempts + 1, riskScore });
        throw new BadRequestException('QR_INVALID_PIN');
      }
    }

    // Single-use: consume + mint desktop session + one-time handoff code (60s)
    const code = randomUUID().replace(/-/g, '');
    const authorized: typeof state = {
      ...state,
      status: 'AUTHORIZED',
      scannedByUserId: state.scannedByUserId ?? userId,
      mobileIp: input.ipAddress,
      deviceFingerprint: state.deviceFingerprint ?? input.deviceFingerprint,
      riskScore,
      oneTimeCodeHash: hashNonce(code),
      authorizedUserId: userId,
      expiresAt: Date.now() + QR_TTL_SEC * 1000,
    };
    await this.cache.write(input.qrToken, authorized);

    const user = await this.prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
    // Bind the LIFF mobile device (future logins recognize this fingerprint → lower risk)
    await this.prisma.userDeviceSession
      .create({
        data: {
          userId,
          refreshTokenHash: hashNonce(`liff:${input.qrToken}:${input.deviceFingerprint}`),
          deviceType: 'LINE_LIFF',
          deviceFingerprint: input.deviceFingerprint,
          ipAddress: input.ipAddress,
        },
      })
      .catch(() => undefined);
    await this.prisma.qrSessionNonce
      .updateMany({ where: { qrToken: input.qrToken }, data: { status: 'AUTHORIZED', scannedByUserId: userId, mobileIpAddress: input.ipAddress } })
      .catch(() => undefined);
    await this.prisma.authAuditLog
      .create({
        data: { userId, tenantId: state.tenantId, event: 'QR_AUTHORIZED', ipAddress: input.ipAddress, userAgent: input.userAgent, metadata: { qrToken: input.qrToken, riskScore } },
      })
      .catch(() => undefined);

    await this.gateway
      .broadcast(input.qrToken, {
        status: 'AUTHORIZED',
        oneTimeCode: code,
        userProfile: user
          ? { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, role: user.role }
          : undefined,
      })
      .catch(() => undefined);

    return { success: true, authorizedAt: new Date().toISOString(), deviceInfo: input.deviceFingerprint };
  }

  async reject(input: { qrToken: string; accessToken: string; reason?: string }): Promise<boolean> {
    let userId = 'unknown';
    try {
      userId = this.tokens.verifyAccessToken(input.accessToken).sub;
    } catch {
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }
    const state = await this.cache.read(input.qrToken).catch(() => null);
    if (!state) throw new BadRequestException('QR_SESSION_EXPIRED');
    await this.toRejected(input.qrToken, state.tenantId, input.reason ?? 'USER_REJECTED', userId).catch(() => undefined);
    return true;
  }

  /** Desktop handoff: single-use code -> Session + device binding + audit. Caller sets __Host cookies. */
  async complete(input: {
    qrToken: string;
    code: string;
    deviceFingerprint: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; userId: string; tenantId: string }> {
    const state = await this.cache.consume(input.qrToken).catch(() => null);
    if (!state || state.status !== 'AUTHORIZED' || !state.oneTimeCodeHash || !state.authorizedUserId) {
      throw new BadRequestException('QR_INVALID_STATE');
    }
    if (!safeEqualHex(hashNonce(input.code), state.oneTimeCodeHash)) {
      throw new UnauthorizedException('QR_INVALID_CODE');
    }
    const user = await this.prisma.user.findUnique({ where: { id: state.authorizedUserId } }).catch(() => null);
    if (!user) throw new UnauthorizedException('User not found');

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tenantId: state.tenantId,
        sessionToken: randomUUID(),
        refreshToken: randomUUID(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent.slice(0, 500),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const pair = this.tokens.issueDualToken(
      { id: user.id, lineUserId: user.lineUserId, email: user.email, role: user.role },
      state.tenantId,
      session.id,
    );
    await this.prisma.userDeviceSession
      .create({
        data: {
          userId: user.id,
          refreshTokenHash: hashNonce(session.refreshToken),
          deviceType: 'DESKTOP_WEB',
          deviceFingerprint: input.deviceFingerprint,
          ipAddress: input.ipAddress,
        },
      })
      .catch(() => undefined);
    await this.redisSet(`session:${session.id}`, { userId: user.id, role: user.role, tenantId: state.tenantId });
    await this.prisma.authAuditLog
      .create({
        data: { userId: user.id, tenantId: state.tenantId, event: 'QR_DESKTOP_LOGIN', ipAddress: input.ipAddress, userAgent: input.userAgent, metadata: { qrToken: input.qrToken } },
      })
      .catch(() => undefined);
    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, expiresIn: pair.expiresIn, userId: user.id, tenantId: state.tenantId };
  }

  private async toRejected(qrToken: string, tenantId: string, reason: string, userId?: string): Promise<void> {
    const state = await this.cache.read(qrToken).catch(() => null);
    if (state && (state.status === 'PENDING' || state.status === 'SCANNED')) {
      await this.cache.transition(qrToken, 'REJECTED');
    }
    await this.prisma.qrSessionNonce.updateMany({ where: { qrToken }, data: { status: 'REJECTED' } }).catch(() => undefined);
    await this.prisma.authAuditLog
      .create({ data: { userId: userId ?? null, tenantId, event: 'QR_REJECTED', ipAddress: 'unknown', userAgent: 'qr', metadata: { qrToken, reason } } })
      .catch(() => undefined);
    await this.gateway.broadcast(qrToken, { status: 'REJECTED', errorMessage: reason }).catch(() => undefined);
  }

  private async redisSet(key: string, value: Record<string, string>): Promise<void> {
    await this.cache.writeRaw(key, JSON.stringify(value), 900).catch(() => undefined);
  }
}
