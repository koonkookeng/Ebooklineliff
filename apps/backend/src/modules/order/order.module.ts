// SSOT Phase 012 — order bounded-context module (checkout + slip-verify orchestration)
// Phase 013: imports PromptPayModule for the slip-verify fraud hook + QR totals
// (no cycle — PromptPayModule never imports OrderModule).
// Phase 014: hosts the v1 payment facade (base64→R2→atomic verify) — its deps
// (SlipUploadService, SlipVerifyService) already live in this module.
import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { PromptPayModule } from '../payment/promptpay.module';
import { CheckoutService } from './services/checkout.service';
import { SlipVerifyService } from './services/slip-verify.service';
import { SlipUploadService } from './services/slip-upload.service';
import { EasySlipVerifyAdapter } from '../payment/services/easyslip-verify.adapter';
import { EasySlipProvider } from '../payment/providers/easyslip.provider';
import { SlipVerificationService } from '../payment/slip-verification.service';
import { PaymentSlipController } from '../payment/slip-verification.controller';
import { PaymentResolver } from '../../api/graphql/resolvers/payment.resolver';
import { OrderAtomicService } from './services/order-atomic.service';
import { EntitlementService } from '../entitlement/services/entitlement.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { OrderResolver } from './presentation/order.resolver';
import { CheckoutController } from './presentation/rest/checkout.controller';
import { SlipVerifyController } from './presentation/rest/slip-verify.controller';
import { SlipUploadController } from './presentation/rest/slip-upload.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
// CartModule import: checkout derives shipping from the live cart split calculator.
@Module({
  imports: [CartModule, PromptPayModule],
  controllers: [CheckoutController, SlipVerifyController, SlipUploadController, PaymentSlipController],
  providers: [CheckoutService, SlipVerifyService, SlipUploadService, EasySlipVerifyAdapter, EasySlipProvider, SlipVerificationService, EntitlementGrantService, EntitlementService, OrderAtomicService, OrderResolver, PaymentResolver],
  exports: [CheckoutService, SlipVerifyService, SlipUploadService, SlipVerificationService, EntitlementGrantService, EntitlementService, OrderAtomicService],
})
export class OrderModule {}
