// SSOT Phase 085 §5.1 — KYC module wiring
// Canonical: apps/backend/src/modules/kyc/kyc.module.ts
// (legacy class name KycModuleModule renamed — no importers.
// pii-crypto.service.ts stays 111-owned (key rotation); everything else in
// this folder ships with 085 — asserted in 085 tests.)
// - AES engine + fuzzy bank match + staged OCR + stream queue + swappable
//   Flex notify -> verification orchestrator + Prisma store -> submission +
//   admin REST + GQL. R2 private vault via R2StorageService.
// - Phase 111 additive: PiiCryptoService facade (mask helpers), KycRiskService
//   (§7.1 tiers + blind-index duplicates), KycQueueReviewService (paginated
//   queue + atomic VERIFIED→SELLER verdicts + Flex), KycQueueResolver/
//   KycQueueController, 300s docViewUrl. 085 providers untouched.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { KycEncryptionService } from './services/kyc-encryption.service';
import { BankValidationService } from './services/bank-validation.service';
import { DopaLaserAdapter } from './adapters/dopa-laser.adapter';
import { OcrEngineAdapter } from './adapters/ocr-engine.adapter';
import { OcrVisionAdapter } from './infra/ocr-vision.adapter';
import { R2PrivateVaultClient } from './infra/r2-private-vault.client';
import { KycOcrService } from './services/kyc-ocr.service';
import { KycQueueService } from './services/kyc-queue.service';
import { KycRiskService } from './services/kyc-risk.service';
import { PiiCryptoService } from './services/pii-crypto.service';
import { LogOnlyKycNotify, KycNotificationService } from './services/kyc-notification.service';
import { KycVerificationService, PrismaKycStore } from './services/kyc-verification.service';
import { KycSubmissionController } from './controllers/kyc-submission.controller';
import { KycAdminController } from './controllers/kyc-admin.controller';
import { KycQueueController } from './controllers/kyc-queue.controller';
import { KycResolver } from './resolvers/kyc.resolver';
import { KycQueueResolver } from './resolvers/kyc-queue.resolver';
import { KycQueueReviewService } from './services/kyc-queue-review.service';

@Module({
  controllers: [KycSubmissionController, KycAdminController, KycQueueController],
  providers: [
    KycEncryptionService,
    BankValidationService,
    DopaLaserAdapter,
    OcrEngineAdapter,
    OcrVisionAdapter,
    R2PrivateVaultClient,
    KycOcrService,
    KycQueueService,
    KycRiskService,
    {
      provide: PiiCryptoService,
      useFactory: (enc: KycEncryptionService) => new PiiCryptoService(enc),
      inject: [KycEncryptionService],
    },
    KycQueueReviewService,
    KycQueueResolver,
    LogOnlyKycNotify,
    KycNotificationService,
    PrismaKycStore,
    {
      provide: KycVerificationService,
      useFactory: (
        store: PrismaKycStore,
        prisma: PrismaService,
        encryption: KycEncryptionService,
        bank: BankValidationService,
        ocr: KycOcrService,
        queue: KycQueueService,
      ) =>
        new KycVerificationService(
          store,
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          encryption,
          bank,
          ocr,
          queue,
        ),
      inject: [PrismaKycStore, PrismaService, KycEncryptionService, BankValidationService, KycOcrService, KycQueueService],
    },
    {
      provide: KycResolver,
      useFactory: (kyc: KycVerificationService, vault: R2PrivateVaultClient) =>
        new KycResolver(kyc, vault),
      inject: [KycVerificationService, R2PrivateVaultClient],
    },
  ],
  exports: [KycVerificationService, PrismaKycStore, KycEncryptionService, PiiCryptoService, KycRiskService, KycQueueReviewService],
})
export class KycModule {}
