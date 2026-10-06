// SSOT Phase 007 §5.1/BDD — init QR session (ephemeral nonce, 60s TTL, PENDING)
// Canonical: .../qr-sync/application/use-cases/init-qr-session.use-case.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../../../infra/database/prisma.service';
import {
  RedisQrCacheRepository,
  qrChannel,
} from '../../infrastructure/repositories/redis-qr-cache.repository';
import { QR_TTL_SEC } from '../../domain/entities/qr-session.entity';
import {
  generateQrToken,
  generateNonce,
  hashNonce,
  sealEnvelope,
} from '../../domain/value-objects/ephemeral-nonce.vo';
import type { InitQrSessionResponse } from '@repo/shared';

const TenantIdSchema = z.string().uuid();

@Injectable()
export class InitQrSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisQrCacheRepository,
  ) {}

  async init(input: { desktopIp: string | null; tenantId: string }): Promise<InitQrSessionResponse> {
    if (!TenantIdSchema.safeParse(input.tenantId).success) {
      throw new BadRequestException('Invalid tenant');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } }).catch(() => null);
    if (!tenant || !tenant.isActive) throw new BadRequestException('Invalid tenant');

    const qrToken = generateQrToken();
    const nonce = generateNonce();
    const expiresAt = Date.now() + QR_TTL_SEC * 1000;
    const envelope = sealEnvelope({ qrToken, nonce, exp: Math.floor(expiresAt / 1000) });

    await this.cache.createInitial({
      qrToken,
      nonceHash: hashNonce(nonce),
      socketChannel: qrChannel(qrToken),
      tenantId: tenant.id,
      desktopIp: input.desktopIp,
      mobileIp: null,
      scannedByUserId: null,
      deviceFingerprint: null,
      pinHash: null,
      oneTimeCodeHash: null,
      authorizedUserId: null,
      expiresAt,
    });

    // Durable audit row (hot state lives in Redis)
    await this.prisma.qrSessionNonce
      .create({
        data: {
          qrToken,
          nonceHash: hashNonce(nonce),
          socketClientId: qrChannel(qrToken),
          desktopIpAddress: input.desktopIp,
          expiresAt: new Date(expiresAt),
        },
      })
      .catch(() => undefined);

    return { qrToken, encryptedNonce: envelope, expiresInSec: QR_TTL_SEC, websocketChannel: qrChannel(qrToken) };
  }
}
