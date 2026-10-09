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
// Phase 035: LineSandboxModule (review sandbox audit runner + verification).
// Phase 036: R2StorageModule (zero-egress vault transport + media delivery).
// Phase 038: PipelineModule (book ingestion worker engine).
// Phase 039: ChunkCacheModule (Redis edge chunk delivery + R2 warm path).
// Phase 040: ReaderModule (entitled reader service + chunk/progress REST + GQL).
// Phase 041: reader controls ride ReaderModule (bookmarks/highlights/preferences).
// Phase 042: WatermarkModule (forensic seed issuance + tamper audit + GQL/REST).
// Phase 043: StreamModule (upload presign + transcode queue + HLS delivery).
// Phase 047: QuizModule (in-video quiz grading + checkpoints + unlock tokens).
// Phase 048: CertificateModule (auto-certificate PDF + QR + HMAC verification).
// Phase 049: DrmModule (canvas tile-shuffle sessions + LSB forensic audit).
// Phase 050: VideoSecurityModule (HLS rate-limit guard + short-lived token DRM).
// Phase 051: PreviewModule (10-page / 120s preview gatekeeper + REST + GQL).
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
import { TenantResolverModule } from './modules/tenant/tenant-resolver.module';
import { KeepAliveModule } from './modules/keep-alive/keep-alive.module';
import { PermissionModule } from './modules/permission/permission.module';
import { VersionModule } from './modules/version/version.module';
import { LineOAModule } from './modules/line-oa/line-oa.module';
import { LineWebhooksModule } from './webhooks/line-webhooks.module';
import { LineSandboxModule } from './modules/line-sandbox/line-sandbox.module';
import { R2StorageModule } from './infra/cloudflare/r2-storage.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ChunkCacheModule } from './modules/reader/cache/chunk-cache.module';
import { ReaderModule } from './modules/reader/reader.module';
import { WatermarkModule } from './modules/watermark/watermark.module';
import { StreamModule } from './modules/stream/stream.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { CertificateModule } from './modules/certificate/certificate.module';
import { DrmModule } from './modules/drm/drm.module';
import { VideoSecurityModule } from './modules/stream/video-security.module';
import { PreviewModule } from './modules/preview/preview.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HlsStreamModule } from './modules/stream/hls-stream.module';
import { ViewportModule } from './modules/viewport/viewport.module';
import { SyncModule } from './modules/sync/sync.module';
import { OfflineSyncModule } from './modules/offline-sync/offline-sync.module';
import { OfflineModule } from './modules/offline/offline.module';
import { OfflineProgressModule } from './modules/progress/progress.module';
import { NoteModule } from './modules/note/note.module';
import { UserPreferenceModule } from './modules/user-preference/user-preference.module';
import { QualityModule } from './modules/stream/quality/quality.module';
import { OfflineLicenseModule } from './modules/offline-license/offline-license.module';
import { NetworkHealthModule } from './modules/network/network-health.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { ProductBuilderModule } from './modules/product-builder/product-builder.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { CourseStudioModule } from './modules/course-studio/course-studio.module';
import { AffiliateModule } from './modules/affiliate/affiliate.module';
// Phase 080: ShareModule (one-click Flex share + HMAC click attribution + metrics).
import { ShareModule } from './modules/share/share.module';
// Phase 081: FinanceModule (double-entry ledger + payout + tax) + CommissionModule (rule-driven splits).
import { FinanceModule } from './modules/finance/finance.module';
import { CommissionModule } from './modules/commission/commission.module';
// Phase 082: TaxModule (3% withholding + 50 Tawi PDF + e-Tax export).
import { TaxModule } from './modules/tax/tax.module';
// Phase 083: GamificationModule (streak/badge/catalog redemption).
import { GamificationModule } from './modules/gamification/gamification.module';
// Phase 084: MessagingModule (abandoned-cart recovery + Flex + coupons).
import { MessagingModule } from './modules/messaging/messaging.module';
// Phase 085: KycModule (creator e-KYC + payout account approval).
import { KycModule } from './modules/kyc/kyc.module';
// Phase 086: PayoutModule (KYC-gated requests + bank clearing + tax PDF).
import { PayoutModule } from './modules/payout/payout.module';
// Phase 087: FlashSaleModule (atomic Lua locks + countdown + reservations).
import { FlashSaleModule } from './modules/flash-sale/flash-sale.module';
// Phase 088: PromotionModule (stackable coupons + points + Redlock).
import { PromotionModule } from './modules/promotion/promotion.module';
// Phase 089: GiftModule (gift orders + atomic claims + expiry reversion).
import { GiftModule } from './modules/gift/gift.module';
// Phase 090: GroupBuyingModule (rooms + atomic joins + expiry refunds).
import { GroupBuyingModule } from './modules/group-buying/group-buying.module';
// Phase 091: VectorSearchModule + AiRagModule (pgvector semantic search + RAG ask).
import { VectorSearchModule } from './modules/vector-search/vector-search.module';
import { AiRagModule } from './modules/ai-rag/ai-rag.module';
// Phase 092: AiCompanionModule (chat sessions + adaptive quiz + guardrails).
import { AiCompanionModule } from './modules/ai-companion/ai-companion.module';
// Phase 093: AdaptiveTestingModule (IRT 3PL theta engine + next-item selection).
import { AdaptiveTestingModule } from './modules/adaptive-testing/adaptive-testing.module';
// Phase 094: AiCopilotModule (outline + transcribe + subtitles + quiz gen).
import { AiCopilotModule } from './modules/ai-copilot/ai-copilot.module';
// Phase 095: SocialReadingModule (margin notes + likes + privacy lattice).
import { SocialReadingModule } from './modules/social-reading/social-reading.module';
// Phase 096: SquadModule + LeaderboardModule (squads + sorted-set boards;
// point engine rides the existing GamificationModule).
import { SquadModule } from './modules/squad/squad.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
// Phase 097: B2bModule (corporate pools + atomic seat claims + HR dashboard).
import { B2bModule } from './modules/b2b/b2b.module';
// Phase 098: B2bHrModule (org seats + quiz tracking + HR analytics + PDF export).
import { B2bHrModule } from './modules/b2b-hr/b2b-hr.module';
// Phase 099: LiveModule (low-latency sessions + HMAC playback + SSE chat + VOD).
import { LiveModule } from './modules/live/live.module';
// Phase 103: SupportModule (hybrid AI chatbot + helpdesk tickets).
import { SupportModule } from './modules/support/support.module';
import { AiBotModule } from './modules/ai-bot/ai-bot.module';
// Phase 104: RecommendationModule (hybrid AI slate + event ingestion).
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { InventoryModule } from './modules/inventory/inventory.module';

@Module({
  imports: [InfraModule, HealthModule, IdentityModule, AuthModule, CatalogModule, CartModule, OrderModule, PromptPayModule, WalletModule, LibraryModule, LineMessagingModule, HeaderModule, LineServiceMessageModule, ResolverModule, SocialShareModule, NavigationModule, SecurityModule, PerformanceModule, TenantThemeModule, TenantResolverModule, KeepAliveModule, PermissionModule, VersionModule, LineOAModule, LineWebhooksModule,     LineSandboxModule, R2StorageModule, PipelineModule, ChunkCacheModule, ReaderModule, WatermarkModule, StreamModule, QuizModule, CertificateModule, DrmModule, VideoSecurityModule, PreviewModule, AnalyticsModule, HlsStreamModule, ViewportModule, SyncModule, OfflineSyncModule, OfflineModule, OfflineProgressModule, NoteModule, UserPreferenceModule, QualityModule, OfflineLicenseModule, NetworkHealthModule, MerchantModule, ProductBuilderModule, InventoryModule, FulfillmentModule, LogisticsModule, CourseStudioModule, AffiliateModule, ShareModule, FinanceModule, CommissionModule, TaxModule, GamificationModule, MessagingModule, KycModule, PayoutModule, FlashSaleModule, PromotionModule, GiftModule, GroupBuyingModule, VectorSearchModule, AiRagModule, AiCompanionModule, AdaptiveTestingModule, AiCopilotModule, SocialReadingModule, SquadModule, LeaderboardModule, B2bModule, B2bHrModule, LiveModule, SupportModule, AiBotModule, RecommendationModule, ApolloServerGatewayModule, WebhooksModule],
})
export class AppModule {}
