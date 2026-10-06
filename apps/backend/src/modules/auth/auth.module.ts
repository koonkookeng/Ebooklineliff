// SSOT Phase 005 §5.1 — NestJS Auth module (Unified SSO: LINE LIFF / Web OAuth / Google)
import { Module } from '@nestjs/common';
import { LineOAuthAdapter } from './adapters/line-oauth.adapter';
import { GoogleOAuthAdapter } from './adapters/google-oauth.adapter';
import { TokenService } from './services/token.service';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthWebhookController } from './controllers/auth-webhook.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
@Module({
  controllers: [AuthWebhookController],
  providers: [
    LineOAuthAdapter,
    GoogleOAuthAdapter,
    TokenService,
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [AuthService, TokenService, JwtStrategy, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
