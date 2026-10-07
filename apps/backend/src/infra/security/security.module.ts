// SSOT Phase 028 §5.1 — Security module (CSP middleware + report sink + guard)
// Canonical: apps/backend/src/infra/security/security.module.ts
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ContentSecurityPolicyMiddleware } from './csp.middleware';
import { CorsWhitelistGuard } from './cors-whitelist.guard';
import { CspReportController } from './csp-report.controller';

@Module({
  controllers: [CspReportController],
  providers: [ContentSecurityPolicyMiddleware, CorsWhitelistGuard],
  exports: [CorsWhitelistGuard],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ContentSecurityPolicyMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
