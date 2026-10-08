// SSOT Phase 073 §5.1 — Merchant module wiring
// Canonical: apps/backend/src/modules/merchant/merchant.module.ts
// - Studio (product/upsert + R2 presigned upload), payout (atomic 3% tax),
//   fulfillment labels, tenant-isolated analytics + GQL intents.
// - PrismaService/R2/Redis from @Global InfraModule; guards are global
//   singletons (JwtAuthGuard needs JwtStrategy provider — imported AuthModule
//   pattern skipped: guards resolve via existing registrations).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { MerchantTaxCalculator } from './domain/services/tax-calculator.domain-service';
import { CreateProductStudioUseCase } from './application/use-cases/create-product-studio.usecase';
import { ProcessPayoutRequestUseCase } from './application/use-cases/process-payout-request.usecase';
import { GenerateShippingLabelUseCase } from './application/use-cases/generate-shipping-label.usecase';
import { PrismaMerchantRepository } from './infrastructure/repositories/prisma-merchant.repository';
import { MerchantStudioController } from './infrastructure/controllers/merchant-studio.controller';
import { MerchantPayoutController } from './infrastructure/controllers/merchant-payout.controller';
import { MerchantStudioResolver } from './infrastructure/graphql/resolvers/merchant-studio.resolver';

@Module({
  controllers: [MerchantStudioController, MerchantPayoutController],
  providers: [
    MerchantTaxCalculator,
    PrismaMerchantRepository,
    {
      provide: CreateProductStudioUseCase,
      useFactory: (repo: PrismaMerchantRepository) => new CreateProductStudioUseCase(repo),
      inject: [PrismaMerchantRepository],
    },
    {
      provide: ProcessPayoutRequestUseCase,
      useFactory: (repo: PrismaMerchantRepository, tax: MerchantTaxCalculator) =>
        new ProcessPayoutRequestUseCase(repo, tax),
      inject: [PrismaMerchantRepository, MerchantTaxCalculator],
    },
    {
      provide: GenerateShippingLabelUseCase,
      useFactory: (repo: PrismaMerchantRepository) => new GenerateShippingLabelUseCase(repo),
      inject: [PrismaMerchantRepository],
    },
    {
      provide: MerchantStudioResolver,
      useFactory: (products: CreateProductStudioUseCase, repo: PrismaMerchantRepository) =>
        new MerchantStudioResolver(products, repo),
      inject: [CreateProductStudioUseCase, PrismaMerchantRepository],
    },
  ],
  exports: [PrismaMerchantRepository, MerchantTaxCalculator],
})
export class MerchantModule {}
