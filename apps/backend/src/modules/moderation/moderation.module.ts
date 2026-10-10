// SSOT Phase 112 Task 2 §5.1 — moderation module wiring
// Canonical: apps/backend/src/modules/moderation/moderation.module.ts
// (legacy scaffold class renamed — no importers.)
// - NSFW text classifier + staged frame seam + simhash copyright scanner ->
//   engine orchestrator (atomic quarantine) + appeal workflow + FIFO worker
//   + scan/appeal REST. R2 reads ride getObjectBuffer digests (zero egress);
//   Redis owns the event stream + rescan shield. Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { NsfwDetectorService } from './services/nsfw-detector.service';
import { CopyrightScannerService } from './services/copyright-scanner.service';
import { LogOnlyModerationNotify, ModerationNotificationService } from './services/moderation-notify.service';
import { ModerationEngineService } from './services/moderation-engine.service';
import { AppealManagerService } from './services/appeal-manager.service';
import { ModerationQueueProcessor } from './queues/moderation.processor';
import { ModerationWebhookController } from './controllers/moderation-webhook.controller';
import { CreatorAppealController } from './controllers/creator-appeal.controller';
import { ModerationAdminController } from './controllers/moderation-admin.controller';
import { ModerationResolver } from './resolvers/moderation.resolver';

@Module({
  controllers: [ModerationWebhookController, CreatorAppealController, ModerationAdminController],
  providers: [
    NsfwDetectorService,
    CopyrightScannerService,
    LogOnlyModerationNotify,
    ModerationNotificationService,
    {
      provide: ModerationEngineService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        nsfw: NsfwDetectorService,
        copyright: CopyrightScannerService,
        notify: ModerationNotificationService,
      ) => new ModerationEngineService(prisma, redis, nsfw, copyright, notify),
      inject: [PrismaService, RedisClusterService, NsfwDetectorService, CopyrightScannerService, ModerationNotificationService],
    },
    {
      provide: AppealManagerService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService, notify: ModerationNotificationService) =>
        new AppealManagerService(prisma, redis, notify),
      inject: [PrismaService, RedisClusterService, ModerationNotificationService],
    },
    {
      provide: ModerationQueueProcessor,
      useFactory: (engine: ModerationEngineService) => new ModerationQueueProcessor(engine),
      inject: [ModerationEngineService],
    },
    {
      provide: ModerationResolver,
      useFactory: (engine: ModerationEngineService, appeals: AppealManagerService) =>
        new ModerationResolver(engine, appeals),
      inject: [ModerationEngineService, AppealManagerService],
    },
  ],
  exports: [ModerationEngineService, AppealManagerService, ModerationQueueProcessor, ModerationResolver, NsfwDetectorService, CopyrightScannerService],
})
export class ModerationModule {}
