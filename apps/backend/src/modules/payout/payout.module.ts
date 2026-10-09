// SSOT Phase 086 §5.1 — Payout clearing module wiring
// Canonical: apps/backend/src/modules/payout/payout.module.ts
// (legacy class name PayoutModuleModule renamed — no importers.)
// - KYC-gated request (delegates hold to 081 FinancePayoutService) +
//   admin batch clearing (bank-gateway staged transport) + 50TW tax PDF
//   (delegates to 082) + integrity probe + REST/GQL. No duplicate payout
//   table or tax math (single writers: 081 ledger, 082 PDF).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { FinanceModule } from '../finance/finance.module';
import { TaxModule } from '../tax/tax.module';
import { KycModule } from '../kyc/kyc.module';
import { FinancePayoutService } from '../finance/application/payout.service';
import { BalanceCalculatorService } from '../finance/application/balance-calculator.service';
import { Generate50TawiPdfUseCase } from '../tax/application/use-cases/generate-50-tawi-pdf.use-case';
import { KycEncryptionService } from '../kyc/services/kyc-encryption.service';
import { RequestPayoutUseCase } from './application/use-cases/request-payout.use-case';
import { ProcessBatchClearingUseCase } from './application/use-cases/process-batch-clearing.use-case';
import { GenerateTaxPdfUseCase } from './application/use-cases/generate-tax-pdf.use-case';
import { LedgerIntegrityService } from './domain/services/ledger-integrity.service';
import { KasikornPayoutAdapter } from './infrastructure/bank-gateway/kasikorn-payout.adapter';
import { ScbPayoutAdapter } from './infrastructure/bank-gateway/scb-payout.adapter';
import { WithholdingTaxPdfGenerator } from './infrastructure/pdf/withholding-tax-pdf.generator';
import { PrismaClearingStore } from './infrastructure/clearing.store';
import { PayoutController } from './controllers/payout.controller';
import { PayoutResolver } from './resolvers/payout.resolver';

@Module({
  imports: [FinanceModule, TaxModule, KycModule],
  controllers: [PayoutController],
  providers: [
    KasikornPayoutAdapter,
    ScbPayoutAdapter,
    WithholdingTaxPdfGenerator,
    PrismaClearingStore,
    GenerateTaxPdfUseCase,
    {
      provide: RequestPayoutUseCase,
      useFactory: (
        finance: FinancePayoutService,
        store: PrismaClearingStore,
        prisma: PrismaService,
        redis: RedisClusterService,
        encryption: KycEncryptionService,
      ) =>
        new RequestPayoutUseCase(
          finance,
          {
            verifiedPayoutProfile: async (userId: string) => {
              const db = prisma as unknown as {
                creatorKYC: {
                  findUnique(a: unknown): Promise<{
                    status: string;
                    firstNameTh: string | null;
                    lastNameTh: string | null;
                    taxId: string | null;
                    payoutAccount: {
                      bankCode: string;
                      bankAccountNumberEnc: string;
                      bankAccountName: string;
                      status: string;
                    } | null;
                  } | null>;
                };
              };
              const kyc = await db.creatorKYC
                .findUnique({ where: { userId }, include: { payoutAccount: true } })
                .catch(() => null);
              if (!kyc || kyc.status !== 'VERIFIED' || !kyc.payoutAccount) return null;
              if (kyc.payoutAccount.status !== 'ACTIVE') return null;
              // Decrypt inside the transport boundary (§8.1 — never logged).
              let accountNumber = '';
              try {
                accountNumber = encryption.decrypt(kyc.payoutAccount.bankAccountNumberEnc);
              } catch {
                return null;
              }
              return {
                bankName: kyc.payoutAccount.bankCode,
                accountNumber,
                accountName: kyc.payoutAccount.bankAccountName,
                taxId: kyc.taxId ?? '',
                payeeName: `${kyc.firstNameTh ?? ''} ${kyc.lastNameTh ?? ''}`.trim(),
                payeeAddress: '',
              };
            },
          },
          store,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [FinancePayoutService, PrismaClearingStore, PrismaService, RedisClusterService, KycEncryptionService],
    },
    {
      provide: ProcessBatchClearingUseCase,
      useFactory: (
        finance: FinancePayoutService,
        store: PrismaClearingStore,
        kbank: KasikornPayoutAdapter,
        scb: ScbPayoutAdapter,
        redis: RedisClusterService,
      ) =>
        new ProcessBatchClearingUseCase(
          finance,
          store,
          {
            // KBANK-majority batches ride Kasikorn, the rest SCB.
            bankCode: 'ROUTER',
            stageBatch: async (args) => {
              const kbankCount = args.items.filter((i) => i.bankName === 'KBANK').length;
              const adapter = kbankCount * 2 >= args.items.length ? kbank : scb;
              return adapter.stageBatch(args);
            },
          },
          {
            xadd: (stream: string, fields: Record<string, string | number>) =>
              redis.xaddPipeline(stream, [fields]),
          },
        ),
      inject: [FinancePayoutService, PrismaClearingStore, KasikornPayoutAdapter, ScbPayoutAdapter, RedisClusterService],
    },
    {
      provide: LedgerIntegrityService,
      useFactory: (balances: BalanceCalculatorService, store: PrismaClearingStore) =>
        new LedgerIntegrityService(balances, store),
      inject: [BalanceCalculatorService, PrismaClearingStore],
    },
    {
      provide: PayoutResolver,
      useFactory: (
        request: RequestPayoutUseCase,
        clearing: ProcessBatchClearingUseCase,
        store: PrismaClearingStore,
      ) => new PayoutResolver(request, clearing, store),
      inject: [RequestPayoutUseCase, ProcessBatchClearingUseCase, PrismaClearingStore],
    },
  ],
  exports: [RequestPayoutUseCase, ProcessBatchClearingUseCase, GenerateTaxPdfUseCase, LedgerIntegrityService, PrismaClearingStore],
})
export class PayoutModule {}
