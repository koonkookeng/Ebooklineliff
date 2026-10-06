// SSOT Phase 012 — order bounded-context module (checkout + slip-verify orchestration)
import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CheckoutService } from './services/checkout.service';
import { SlipVerifyService } from './services/slip-verify.service';
import { SlipUploadService } from './services/slip-upload.service';
import { EasySlipVerifyAdapter } from '../payment/services/easyslip-verify.adapter';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { OrderResolver } from './presentation/order.resolver';
import { CheckoutController } from './presentation/rest/checkout.controller';
import { SlipVerifyController } from './presentation/rest/slip-verify.controller';
import { SlipUploadController } from './presentation/rest/slip-upload.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
// CartModule import: checkout derives shipping from the live cart split calculator.
@Module({
  imports: [CartModule],
  controllers: [CheckoutController, SlipVerifyController, SlipUploadController],
  providers: [CheckoutService, SlipVerifyService, SlipUploadService, EasySlipVerifyAdapter, EntitlementGrantService, OrderResolver],
  exports: [CheckoutService, SlipVerifyService, SlipUploadService, EntitlementGrantService],
})
export class OrderModule {}
