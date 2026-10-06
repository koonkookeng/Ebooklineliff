// SSOT Phase 001+003+004+008+011+012+013 — NestJS root module
import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InfraModule } from './infra/infra.module';
import { ApolloServerGatewayModule } from './infra/apollo/apollo-server.module';
import { WebhooksModule } from './api/webhooks/webhooks.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { OrderModule } from './modules/order/order.module';
import { PromptPayModule } from './modules/payment/promptpay.module';
import { WalletModule } from './modules/wallet/wallet.module';

@Module({
  imports: [InfraModule, HealthModule, IdentityModule, AuthModule, CatalogModule, CartModule, OrderModule, PromptPayModule, WalletModule, ApolloServerGatewayModule, WebhooksModule],
})
export class AppModule {}
