// SSOT Phase 001+003+004+008 — NestJS root module
import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InfraModule } from './infra/infra.module';
import { ApolloServerGatewayModule } from './infra/apollo/apollo-server.module';
import { WebhooksModule } from './api/webhooks/webhooks.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';

@Module({
  imports: [InfraModule, HealthModule, IdentityModule, AuthModule, CatalogModule, ApolloServerGatewayModule, WebhooksModule],
})
export class AppModule {}
