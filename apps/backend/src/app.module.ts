// SSOT Phase 001+003+004+008+011+012+013 — NestJS root module
// Phase 017: WalletModule (Meb-Killer Credits). Phase 018: LibraryModule (My Library).
// Phase 019: LineMessagingModule (transactional receipts; event-bound, core untouched).
// Phase 023: HeaderModule (dynamic header title integrator + edge cache).
// Phase 024: LineServiceMessageModule (zero-broadcast transactional dispatcher).
// Phase 025: ResolverModule (permanent mini-app scheme + dynamic deep-linking).
// Phase 026: SocialShareModule (native share picker + viral attribution).
// Phase 027: NavigationModule (LIFF shell router + dirty-state guard persistence).
// Phase 028: SecurityModule (strict CSP + CORS whitelist + violation report sink).
// Phase 029: PerformanceModule (2MB bundle guard + predictive prefetch + RUM telemetry).
// Phase 030: TenantThemeModule (dynamic navbar branding + WCAG AA contrast guard).
// Phase 031: KeepAliveModule (viewport keep-alive + cross-device state sync).
// Phase 032: PermissionModule (device permission audit + reverse geocoding).
// Phase 033: VersionModule (auto-update check + device fleet log).
// Phase 034: LineOAModule (OA config/friendship sync) + LineWebhooksModule (follow/unfollow).
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
import { LibraryModule } from './modules/library/library.module';
import { LineMessagingModule } from './modules/notification/line-messaging.module';
import { HeaderModule } from './modules/header/header.module';
import { LineServiceMessageModule } from './modules/line-service-message/line-service-message.module';
import { ResolverModule } from './modules/resolver/resolver.module';
import { SocialShareModule } from './modules/social-share/social-share.module';
import { NavigationModule } from './modules/navigation/navigation.module';
import { SecurityModule } from './infra/security/security.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { TenantThemeModule } from './modules/tenant/tenant-theme.module';
import { KeepAliveModule } from './modules/keep-alive/keep-alive.module';
import { PermissionModule } from './modules/permission/permission.module';
import { VersionModule } from './modules/version/version.module';
import { LineOAModule } from './modules/line-oa/line-oa.module';
import { LineWebhooksModule } from './webhooks/line-webhooks.module';

@Module({
  imports: [InfraModule, HealthModule, IdentityModule, AuthModule, CatalogModule, CartModule, OrderModule, PromptPayModule, WalletModule, LibraryModule, LineMessagingModule, HeaderModule, LineServiceMessageModule, ResolverModule, SocialShareModule, NavigationModule, SecurityModule, PerformanceModule, TenantThemeModule, KeepAliveModule, PermissionModule, VersionModule, LineOAModule, LineWebhooksModule, ApolloServerGatewayModule, WebhooksModule],
})
export class AppModule {}
