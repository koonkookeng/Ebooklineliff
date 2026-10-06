// SSOT Phase 013 §5.1 — PromptPay bounded-context module (dynamic QR lifecycle)
// Canonical: apps/backend/src/modules/payment/promptpay.module.ts
// NOTE: PrismaService + RedisClusterService come from global InfraModule.
// OrderModule imports this module for the slip-verify fraud hook (no cycle:
// this module never imports OrderModule — OrderExpiryService is provided here
// but its file lives under order/services per the phase file-scope).
import { Module } from '@nestjs/common';
import { PromptPayQrService } from './services/promptpay-qr.service';
import { PromptPayGuardService } from './services/promptpay-guard.service';
import { OrderExpiryService } from '../order/services/order-expiry.service';
import { PromptPayController } from './controllers/promptpay.controller';
import { PromptPayResolver } from './promptpay.resolver';

@Module({
  controllers: [PromptPayController],
  providers: [PromptPayQrService, PromptPayGuardService, OrderExpiryService, PromptPayResolver],
  exports: [PromptPayQrService, PromptPayGuardService, OrderExpiryService],
})
export class PromptPayModule {}
