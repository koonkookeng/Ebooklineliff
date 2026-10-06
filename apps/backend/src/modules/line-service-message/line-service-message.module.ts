// SSOT Phase 024 Task 3 — LineServiceMessage module
// Canonical: apps/backend/src/modules/line-service-message/line-service-message.module.ts
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { FlexBuilderService } from './application/flex-builder.service';
import { LineServiceMessageService } from './application/line-service-message.service';
import { LineApiClient } from './infrastructure/line-api.client';
import { MessageDispatcherProcessor } from './infrastructure/processors/message-dispatcher.processor';
import { LineDeliveryStatusController } from './webhooks/line-delivery-status.controller';
import { AdminNotificationsController } from './webhooks/admin-notifications.controller';

@Module({
  controllers: [LineDeliveryStatusController, AdminNotificationsController],
  providers: [FlexBuilderService, LineApiClient, MessageDispatcherProcessor, LineServiceMessageService],
  exports: [LineServiceMessageService, MessageDispatcherProcessor],
})
export class LineServiceMessageModule {}
