// SSOT Phase 004 §5.1 — webhook adapters module
import { Module } from '@nestjs/common';
import { EasySlipWebhookController } from './controllers/easyslip-webhook.controller';
import { LogisticsWebhookController } from './controllers/logistics-webhook.controller';
import { LineMessagingWebhookController } from './controllers/line-messaging-webhook.controller';
import { LogisticsCarrierController } from './logistics-carrier.controller';
import { BankPayoutCallbackController } from './bank-payout-callback.controller';
import { LogisticsModule } from '../../modules/logistics/logistics.module';
import { PayoutModule } from '../../modules/payout/payout.module';
import { KycModule } from '../../modules/kyc/kyc.module';
import { ModerationModule } from '../../modules/moderation/moderation.module';
import { DisputeModule } from '../../modules/dispute/dispute.module';
import { EscrowModule } from '../../modules/escrow/escrow.module';
import { KycOcrCallbackController } from './kyc/kyc-ocr-callback.controller';
import { ModerationEventController } from './moderation/moderation-event.controller';
import { DisputeLogisticsController } from './dispute-logistics.controller';

@Module({
  imports: [LogisticsModule, PayoutModule, KycModule, ModerationModule, DisputeModule, EscrowModule],
  controllers: [EasySlipWebhookController, LogisticsWebhookController, LineMessagingWebhookController, LogisticsCarrierController, BankPayoutCallbackController, KycOcrCallbackController, ModerationEventController, DisputeLogisticsController],
})
export class WebhooksModule {}
