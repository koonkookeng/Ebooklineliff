// SSOT Phase 026 Task 2 — Social share module
// Canonical: apps/backend/src/modules/social-share/social-share.module.ts
// (legacy src/backend/modules/social-share/)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { FlexMessageBuilderService } from './services/flex-message-builder.service';
import { SocialShareService } from './services/social-share.service';
import { ShareAttributionService } from '../affiliate/services/share-attribution.service';
import { SocialShareController } from './controllers/social-share.controller';
import { SocialShareResolver } from './resolvers/social-share.resolver';

@Module({
  controllers: [SocialShareController],
  providers: [FlexMessageBuilderService, SocialShareService, ShareAttributionService, SocialShareResolver],
  exports: [SocialShareService, FlexMessageBuilderService, ShareAttributionService],
})
export class SocialShareModule {}
