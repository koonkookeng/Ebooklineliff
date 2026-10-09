// SSOT Phase 048 Task 5/6 — CertificateModule (Auto-Certificate wiring)
// Canonical: apps/backend/src/modules/certificate/certificate.module.ts
// (legacy src/backend/modules/certificate/certificate.module.ts)
// - useFactory wiring keeps services tsx-importable (Phase 027–047 precedent).
// - PrismaService arrives via global InfraModule; R2 via R2StorageModule.
// - EventEmitter2 for certificate.issued analytics events (Phase 048 §7.1).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { PrismaService } from '../../infra/database/prisma.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { CertificatePdfGeneratorService } from './application/services/certificate-pdf-generator.service';
import { CertificateVerificationService } from './application/services/certificate-verification.service';
import { CourseCompletedEventHandler, CERTIFICATE_EVENT_BUS } from './application/event-handlers/course-completed.handler';
import { CertificateResolver } from './presentation/certificate.resolver';
import { CertificateVerifyController } from './presentation/certificate-verify.controller';
// Phase 105: public QR verification (rich §3.1 payload + audit ledger).
import { PublicCertificateVerificationService } from './certificate-verification.service';
import { PublicCertificateVerificationController } from './certificate-verification.controller';
import { PublicCertificateResolver } from './certificate.resolver';
import { ChromiumPdfRendererAdapter } from './infrastructure/pdf-engine/chromium-pdf-renderer.adapter';
import { QrCodeGeneratorAdapter } from './infrastructure/qr-engine/qr-code-generator.adapter';

@Module({
  imports: [R2StorageModule],
  controllers: [CertificateVerifyController, PublicCertificateVerificationController],
  providers: [
    {
      provide: CERTIFICATE_EVENT_BUS,
      useFactory: (): EventEmitter => new EventEmitter(),
    },
    {
      provide: ChromiumPdfRendererAdapter,
      useFactory: (): ChromiumPdfRendererAdapter => new ChromiumPdfRendererAdapter(),
    },
    {
      provide: QrCodeGeneratorAdapter,
      useFactory: (): QrCodeGeneratorAdapter => new QrCodeGeneratorAdapter(),
    },
    {
      provide: CertificatePdfGeneratorService,
      useFactory: (
        prisma: PrismaService,
        r2: R2StorageService,
        pdfRenderer: ChromiumPdfRendererAdapter,
        qrGenerator: QrCodeGeneratorAdapter,
      ): CertificatePdfGeneratorService =>
        new CertificatePdfGeneratorService(prisma, r2, pdfRenderer, qrGenerator),
      inject: [PrismaService, R2StorageService, ChromiumPdfRendererAdapter, QrCodeGeneratorAdapter],
    },
    {
      provide: CertificateVerificationService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService): CertificateVerificationService =>
        new CertificateVerificationService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: PublicCertificateVerificationService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService): PublicCertificateVerificationService =>
        new PublicCertificateVerificationService(prisma, redis),
      inject: [PrismaService, RedisClusterService],
    },
    {
      provide: CourseCompletedEventHandler,
      useFactory: (
        certService: CertificatePdfGeneratorService,
        eventBus: EventEmitter,
        prisma: PrismaService,
      ): CourseCompletedEventHandler => new CourseCompletedEventHandler(certService, eventBus, prisma),
      inject: [CertificatePdfGeneratorService, CERTIFICATE_EVENT_BUS, PrismaService],
    },
    CertificateResolver,
    PublicCertificateResolver,
  ],
  exports: [CertificatePdfGeneratorService, CertificateVerificationService, PublicCertificateVerificationService],
})
export class CertificateModule {}
