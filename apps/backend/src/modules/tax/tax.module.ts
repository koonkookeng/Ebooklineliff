// SSOT Phase 082 §5.1 — Tax module wiring
// Canonical: apps/backend/src/modules/tax/tax.module.ts
// - Domain math (single source, §9) -> structural repo -> PDF compiler +
//   R2 vault -> calculate/generate use-cases -> GQL + export controller.
// - Queue shape (Task 7): TAX_WITHHELD stream handoff via the shared Redis
//   bus — no BullMQ package (zero-dep rule; 026–081 stream precedent).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { TaxCalculatorDomainService } from './domain/services/tax-calculator.domain-service';
import { PdfCompilerService } from './infrastructure/pdf-generator/pdf-compiler.service';
import { PrismaTaxRepository } from './infrastructure/repositories/tax-prisma.repository';
import { CalculateTaxUseCase } from './application/use-cases/calculate-tax.use-case';
import { Generate50TawiPdfUseCase } from './application/use-cases/generate-50-tawi-pdf.use-case';
import { TaxResolver } from './presentation/graphql/tax.resolver';
import { TaxController } from './presentation/rest/tax.controller';
import { TaxExportController } from './presentation/webhooks/tax-export.controller';

@Module({
  controllers: [TaxController, TaxExportController],
  providers: [
    TaxCalculatorDomainService,
    PdfCompilerService,
    PrismaTaxRepository,
    {
      provide: CalculateTaxUseCase,
      useFactory: (repo: PrismaTaxRepository, redis: RedisClusterService) =>
        new CalculateTaxUseCase(repo, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaTaxRepository, RedisClusterService],
    },
    {
      provide: Generate50TawiPdfUseCase,
      useFactory: (
        repo: PrismaTaxRepository,
        pdf: PdfCompilerService,
        r2: R2StorageService,
        prisma: PrismaService,
        redis: RedisClusterService,
      ) =>
        new Generate50TawiPdfUseCase(
          repo,
          pdf,
          r2,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [PrismaTaxRepository, PdfCompilerService, R2StorageService, PrismaService, RedisClusterService],
    },
    {
      provide: TaxResolver,
      useFactory: (
        calculate: CalculateTaxUseCase,
        generate: Generate50TawiPdfUseCase,
        repo: PrismaTaxRepository,
      ) => new TaxResolver(calculate, generate, repo),
      inject: [CalculateTaxUseCase, Generate50TawiPdfUseCase, PrismaTaxRepository],
    },
  ],
  exports: [CalculateTaxUseCase, Generate50TawiPdfUseCase, PrismaTaxRepository, TaxCalculatorDomainService],
})
export class TaxModule {}
