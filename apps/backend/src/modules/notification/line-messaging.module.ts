// SSOT Phase 019 §5.1 — notification bounded-context module (receipt pipeline)
// Canonical: apps/backend/src/modules/notification/line-messaging.module.ts
// (legacy src/backend/modules/notification/line-messaging.module.ts)
// Owns: LineMessagingService (facade) + ReceiptQueueProcessor (pipeline +
// flex-event subscription) + receipt REST (via payment PaymentSlipController).
// The payment verification core is never imported (event binding only).
import { Module } from '@nestjs/common';
import { LineMessagingService } from './line-messaging.service';
import { ReceiptQueueProcessor } from './processors/receipt-queue.processor';
import { PaymentSlipController } from '../payment/payment-slip.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule.
@Module({
  controllers: [PaymentSlipController],
  providers: [LineMessagingService, ReceiptQueueProcessor],
  exports: [LineMessagingService, ReceiptQueueProcessor],
})
export class LineMessagingModule {}
