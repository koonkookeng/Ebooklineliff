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

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
@Module({
  controllers: [AuthWebhookController],
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
  ],
  exports: [AuthService, TokenService, JwtTokenService, LineVerifierService, JwtStrategy, JwtAuthGuard, RolesGuard, LineLiffGuard],
})
export class AuthModule {}
