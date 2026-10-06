// SSOT Phase 005 §5.1 — NestJS Auth module (Unified SSO: LINE LIFF / Web OAuth / Google)
import { Module } from '@nestjs/common';
import { LineOAuthAdapter } from './adapters/line-oauth.adapter';
import { GoogleOAuthAdapter } from './adapters/google-oauth.adapter';
import { TokenService } from './services/token.service';
import { JwtTokenService } from './services/jwt-token.service';
import { LineVerifierService } from './services/line-verifier.service';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { LineLiffGuard } from './guards/line-liff.guard';
import { AuthWebhookController } from './controllers/auth-webhook.controller';
import { InitQrSessionUseCase } from './qr-sync/application/use-cases/init-qr-session.use-case';
import { ProcessQrScanUseCase } from './qr-sync/application/use-cases/process-qr-scan.use-case';
import { AuthorizeQrSessionUseCase } from './qr-sync/application/use-cases/authorize-qr-session.use-case';
import { RedisQrCacheRepository } from './qr-sync/infrastructure/repositories/redis-qr-cache.repository';
import { QrAuthGateway } from './qr-sync/infrastructure/gateways/qr-auth.gateway';
import { QrAuthWebhookController } from './qr-sync/presentation/controllers/qr-auth-webhook.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
@Module({
  controllers: [AuthWebhookController, QrAuthWebhookController],
  providers: [
    LineOAuthAdapter,
    GoogleOAuthAdapter,
    TokenService,
    JwtTokenService,
    LineVerifierService,
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    LineLiffGuard,
    RedisQrCacheRepository,
    QrAuthGateway,
    InitQrSessionUseCase,
    ProcessQrScanUseCase,
    AuthorizeQrSessionUseCase,
  ],
  exports: [AuthService, TokenService, JwtTokenService, LineVerifierService, JwtStrategy, JwtAuthGuard, RolesGuard, LineLiffGuard, RedisQrCacheRepository, QrAuthGateway, InitQrSessionUseCase, ProcessQrScanUseCase, AuthorizeQrSessionUseCase],
})
export class AuthModule {}
