// SSOT Phase 004 §5.1 — webhook adapters module
import { Module } from '@nestjs/common';
import { EasySlipWebhookController } from './controllers/easyslip-webhook.controller';
import { LogisticsWebhookController } from './controllers/logistics-webhook.controller';
import { LineMessagingWebhookController } from './controllers/line-messaging-webhook.controller';
import { LogisticsCarrierController } from './logistics-carrier.controller';
import { LogisticsModule } from '../../modules/logistics/logistics.module';

@Module({
  imports: [LogisticsModule],
  controllers: [EasySlipWebhookController, LogisticsWebhookController, LineMessagingWebhookController, LogisticsCarrierController],
})
export class WebhooksModule {}
