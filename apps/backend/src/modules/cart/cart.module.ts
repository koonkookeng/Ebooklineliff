// SSOT Phase 011 §5.1 — cart bounded-context module (DDD: domain/app/infra/presentation)
import { Module } from '@nestjs/common';
import { CartRepository } from './infrastructure/cart.repository';
import { ShippingAdapterService } from './infrastructure/shipping-adapter.service';
import { CartService } from './application/cart.service';
import { AddToCartUseCase } from './application/use-cases/add-to-cart.usecase';
import { SplitCartCalculatorUseCase } from './application/use-cases/split-cart-calculator.usecase';
import { CartResolver } from './presentation/cart.resolver';
import { CartController } from './presentation/rest/cart.controller';

// NOTE: PrismaService + RedisClusterService come from global InfraModule (single connection pool).
@Module({
  controllers: [CartController],
  providers: [
    CartRepository,
    ShippingAdapterService,
    CartService,
    AddToCartUseCase,
    SplitCartCalculatorUseCase,
    CartResolver,
  ],
  exports: [CartService, AddToCartUseCase, SplitCartCalculatorUseCase, ShippingAdapterService, CartRepository],
})
export class CartModule {}
