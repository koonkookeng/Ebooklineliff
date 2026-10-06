// SSOT Phase 007 BDD — LIFF scan step (authenticated scan marks SCANNED, desktop notified)
// Canonical: .../qr-sync/application/use-cases/process-qr-scan.use-case.ts
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../../../infra/database/prisma.service';
import { TokenService } from '../../../services/token.service';
import { RedisQrCacheRepository } from '../../infrastructure/repositories/redis-qr-cache.repository';
import { QrAuthGateway } from '../../infrastructure/gateways/qr-auth.gateway';

@Injectable()
export class ProcessQrScanUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisQrCacheRepository,
    private readonly tokens: TokenService,
    private readonly gateway: QrAuthGateway,
  ) {}

  async scan(input: { qrToken: string; accessToken: string; mobileIp: string | null }): Promise<{ success: boolean; status: string }> {
    let userId: string;
    try {
      userId = this.tokens.verifyAccessToken(input.accessToken).sub;
    } catch {
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    }
    const state = await this.cache.read(input.qrToken);
    if (!state) throw new BadRequestException('QR_SESSION_EXPIRED');
    if (state.status !== 'PENDING') throw new BadRequestException(`QR_INVALID_STATE:${state.status}`);

    const next = await this.cache.transition(input.qrToken, 'SCANNED');
    await this.cache.write(input.qrToken, { ...next, scannedByUserId: userId, mobileIp: input.mobileIp });

    await this.prisma.qrSessionNonce
      .updateMany({
        where: { qrToken: input.qrToken },
        data: { status: 'SCANNED', scannedByUserId: userId, mobileIpAddress: input.mobileIp },
      })
      .catch(() => undefined);
    await this.prisma.authAuditLog
      .create({
        data: { userId, tenantId: state.tenantId, event: 'QR_SCANNED', ipAddress: input.mobileIp ?? 'unknown', userAgent: 'liff-scan', metadata: { qrToken: input.qrToken } },
      })
      .catch(() => undefined);

    await this.gateway.broadcast(input.qrToken, { status: 'SCANNED' }).catch(() => undefined);
    return { success: true, status: 'SCANNED' };
  }
}
