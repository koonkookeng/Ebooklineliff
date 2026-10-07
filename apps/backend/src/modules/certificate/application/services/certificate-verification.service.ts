// SSOT Phase 048 §5.2 — CertificateVerificationService (Public verification + HMAC validation)
// Canonical: apps/backend/src/modules/certificate/application/services/certificate-verification.service.ts
// (legacy src/backend/modules/certificate/application/services/certificate-verification.service.ts)
// - Public verify: HMAC check + DB lookup + rate limiting.
// - <200ms lookup budget (Gate 4). Never logs certificate data.
// - Rate limit: 20 req/min per IP (Redis fixed window).
// - Pure + tsx-safe. Zero new deps.
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import { DigitalSignature, buildHmacPayload, timingSafeEquals } from '../../domain/value-objects/digital-signature.vo';

export interface VerificationInput {
  certificateNo: string;
  clientIp: string;
}

export interface VerificationResult {
  isValid: boolean;
  certificateNo: string;
  studentName: string;
  courseTitle: string;
  issuedAt: string;
  issuerName: string;
  digitalSignatureHash: string;
  pdfUrl: string;
}

@Injectable()
export class CertificateVerificationService {
  private readonly logger = new Logger(CertificateVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly hmacSecret: string = process.env.CERTIFICATE_HMAC_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
  ) {}

  async verifyCertificate(input: VerificationInput): Promise<VerificationResult> {
    // Rate limiting: 20 req/min per IP
    await this.checkRateLimit(input.clientIp);

    const cert = await this.prisma.courseCertificate.findUnique({
      where: { certificateNo: input.certificateNo },
      include: { user: true, course: { include: { product: true } } },
    }).catch(() => null);

    if (!cert) {
      return this.buildInvalidResponse(input.certificateNo);
    }

    // Verify HMAC signature
    const payload = `${cert.certificateNo}:${cert.userId}:${cert.courseId}:${cert.user?.displayName}`;
    const isValid = DigitalSignature.verify(payload, this.hmacSecret, cert.digitalSignatureHash);

    if (!isValid) {
      this.logger.warn(`Invalid signature for cert ${input.certificateNo}`);
      return this.buildInvalidResponse(input.certificateNo);
    }

    // Check status
    if (cert.status !== 'ISSUED') {
      return this.buildInvalidResponse(input.certificateNo, cert.status);
    }

    return {
      isValid: true,
      certificateNo: cert.certificateNo,
      studentName: cert.user?.displayName || 'Unknown',
      courseTitle: cert.course?.product?.title || 'Unknown Course',
      issuedAt: cert.issuedAt.toISOString(),
      issuerName: process.env.ISSUER_NAME || 'Ebook Platform',
      digitalSignatureHash: cert.digitalSignatureHash,
      pdfUrl: `${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${cert.pdfStoragePathR2}`,
    };
  }

  /** List all ISSUED certificates earned by a user (Library / getMyCertificates). */
  async getUserCertificates(userId: string): Promise<VerificationResult[]> {
    const rows = await this.prisma.courseCertificate
      .findMany({
        where: { userId, status: 'ISSUED' },
        include: { user: true, course: { include: { product: true } } },
        orderBy: { issuedAt: 'desc' },
      })
      .catch(() => []);
    return rows.map((cert) => ({
      isValid: true,
      certificateNo: cert.certificateNo,
      studentName: cert.user?.displayName || 'Unknown',
      courseTitle: cert.course?.product?.title || 'Unknown Course',
      issuedAt: cert.issuedAt.toISOString(),
      issuerName: process.env.ISSUER_NAME || 'Ebook Platform',
      digitalSignatureHash: cert.digitalSignatureHash,
      pdfUrl: `${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${cert.pdfStoragePathR2}`,
    }));
  }

  private async checkRateLimit(ip: string): Promise<void> {
    const key = `ratelimit:cert-verify:${ip}`;
    const count = await this.redis.incr(key).catch(() => 0);
    if (count === 1) {
      await this.redis.expire(key, 60).catch(() => undefined);
    }
    if (count > 20) {
      throw new HttpException('Too many verification requests', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private buildInvalidResponse(certNo: string, status?: string): VerificationResult {
    return {
      isValid: false,
      certificateNo: certNo,
      studentName: '',
      courseTitle: '',
      issuedAt: '',
      issuerName: '',
      digitalSignatureHash: '',
      pdfUrl: '',
    };
  }
}