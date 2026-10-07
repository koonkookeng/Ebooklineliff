// SSOT Phase 048 Task 3/4 — CertificatePdfGeneratorService (PDF + QR + HMAC + R2)
// Canonical: apps/backend/src/modules/certificate/application/services/certificate-pdf-generator.service.ts
// (legacy src/backend/modules/certificate/application/services/certificate-pdf-generator.service.ts)
// - Orchestrates: completion-gate → QR → HMAC sign → PDF render → R2 upload → DB persist.
// - <1.2s generation budget (Phase 048 BDD). Heavy lifting delegated to injected
//   adapters (lazy-require at call time; unit-tested with fakes).
// - Idempotent: @@unique(userId, courseId) — duplicate issue maps to 400.
// - Zero new deps.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { R2StorageService } from '../../../../infra/cloudflare/r2-storage.service';
import {
  buildHmacPayload,
  buildVerifyUrl,
  certificateR2Path,
  generateCertificateNo,
} from '@repo/shared';
import { DigitalSignature } from '../../domain/value-objects/digital-signature.vo';
import { ChromiumPdfRendererAdapter } from '../../infrastructure/pdf-engine/chromium-pdf-renderer.adapter';
import { QrCodeGeneratorAdapter } from '../../infrastructure/qr-engine/qr-code-generator.adapter';

export interface CertificateGenerationInput {
  userId: string;
  courseId: string;
  tenantId?: string;
}

export interface CertificateGenerationResult {
  certificateNo: string;
  pdfUrl: string;
  qrCodeUrl: string;
  digitalSignatureHash: string;
}

@Injectable()
export class CertificatePdfGeneratorService {
  private readonly logger = new Logger(CertificatePdfGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
    private readonly pdfRenderer: ChromiumPdfRendererAdapter,
    private readonly qrGenerator: QrCodeGeneratorAdapter,
    private readonly hmacSecret: string = process.env.CERTIFICATE_HMAC_SECRET ||
      'AHONG_EMERALD_SECRET_KEY_999',
  ) {}

  async generateCertificate(input: CertificateGenerationInput): Promise<CertificateGenerationResult> {
    const startTime = Date.now();
    this.logger.log(`Generating certificate for user ${input.userId}, course ${input.courseId}`);

    // 1. Idempotency gate: @@unique(userId, courseId).
    const existing = await this.prisma.courseCertificate
      .findUnique({
        where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
      })
      .catch(() => null);
    if (existing) throw new BadRequestException('Certificate already issued');

    // 2. Resolve user + course (fail-fast on invalid ids).
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new BadRequestException('Invalid user');
    const course = await this.prisma.courseDetail.findUnique({
      where: { id: input.courseId },
      include: { sections: { include: { lessons: { select: { id: true, title: true } } } }, product: true },
    });
    if (!course) throw new BadRequestException('Invalid course');

    // 3. Completion gate: every lesson must be isCompleted (per-lesson progress model).
    const lessonIds = (course.sections ?? []).flatMap((s) => (s.lessons ?? []).map((l) => l.id));
    if (lessonIds.length > 0) {
      const rows = await this.prisma.courseLearningProgress.findMany({
        where: { userId: input.userId, lessonId: { in: lessonIds } },
      });
      const done = new Set(rows.filter((r) => r.isCompleted).map((r) => r.lessonId));
      const incomplete = lessonIds.filter((id) => !done.has(id));
      if (incomplete.length > 0) throw new BadRequestException('Course not completed');
    }

    // 4. Cert number + verify URL (SSOT helpers).
    const certNo = generateCertificateNo();
    const qrCodeUrl = buildVerifyUrl(certNo);

    // 5. QR code via injected adapter (lazy qrcode dep with placeholder fallback).
    const qrCodeDataUrl = await this.qrGenerator.toDataUrl(qrCodeUrl, { margin: 1, width: 250 });

    // 6. HMAC-SHA256 digital signature (§8.2: certNo:userId:courseId:displayName).
    const payload = buildHmacPayload(certNo, input.userId, input.courseId, user.displayName);
    const digitalSignatureHash = DigitalSignature.create(payload, this.hmacSecret).toString();

    // 7. Vector-crisp PDF render via injected Chromium adapter.
    const courseTitle = course.product?.title ?? 'Course';
    const pdfHtml = this.pdfRenderer.buildCertificateHtml({
      certificateNo: certNo,
      studentName: user.displayName,
      courseTitle,
      issuedAt: new Date(),
      issuerName: process.env.ISSUER_NAME || 'Ebook Platform',
      qrCodeDataUrl,
      digitalSignatureHash,
      institutionLogoUrl: process.env.INSTITUTION_LOGO_URL,
      signatureImageUrl: process.env.AUTHORIZED_SIGNATURE_IMAGE_URL,
      primaryColor: process.env.CERTIFICATE_PRIMARY_COLOR || '#059669',
      borderStyle: process.env.CERTIFICATE_BORDER_STYLE || 'solid 4px',
    });
    const pdfBuffer = await this.pdfRenderer.renderToPdf(pdfHtml);

    // 8. Zero-egress R2 upload (SigV4 PUT via R2StorageService).
    const r2Path = certificateR2Path(certNo);
    await this.r2.putObjectBuffer(r2Path, pdfBuffer, 'application/pdf');

    // 9. Atomic persist (P2002 race → 400 idempotent).
    try {
      await this.prisma.courseCertificate.create({
        data: {
          certificateNo: certNo,
          userId: input.userId,
          courseId: course.id,
          tenantId: input.tenantId,
          pdfStoragePathR2: r2Path,
          qrCodeUrl,
          digitalSignatureHash,
          status: 'ISSUED',
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new BadRequestException('Certificate already issued');
      }
      throw err;
    }

    const result = {
      certificateNo: certNo,
      pdfUrl: `${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN ?? ''}/${r2Path}`,
      qrCodeUrl,
      digitalSignatureHash,
    };
    this.logger.log(`Certificate generated in ${Date.now() - startTime}ms: ${certNo}`);
    return result;
  }
}
