// SSOT Phase 004 §5.1 — webhook adapters module
import { Module } from '@nestjs/common';
import { EasySlipWebhookController } from './controllers/easyslip-webhook.controller';
import { LogisticsWebhookController } from './controllers/logistics-webhook.controller';
import { LineMessagingWebhookController } from './controllers/line-messaging-webhook.controller';

@Module({
  controllers: [EasySlipWebhookController, LogisticsWebhookController, LineMessagingWebhookController],
})
export class WebhooksModule {}
