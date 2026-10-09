// SSOT Phase 105 Task 3 — Public certificate verification service (§3.1 payload)
// Canonical: apps/backend/src/modules/certificate/certificate-verification.service.ts
// - RISK_CALL: HMAC truth delegates 048 DigitalSignature/buildHmacPayload
//   (payload certNo:userId:courseId:displayName); status reads additive
//   `isRevoked` OR legacy `status`. 048 files untouched.
// - 20 scans/min/IP shield; viewCount++ awaited; audit log fire-and-forget
//   (Gate 7: never slows the <500ms verify path). Zero new deps.
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  CERT_VERIFY_RATE_PER_MIN,
  VerifyCertificateInputSchema,
  certVerifyRateKey,
  type CertificateVerificationPayload,
} from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { fromLegacyStatus } from './domain/certificate-status.enum';
import { verifyPublicHash } from './domain/certificate-hash.verifier';

export interface PublicVerifyArgs {
  certificateNo: string;
  hashSignature?: string;
  ipAddress: string;
  userAgent: string;
}

const FALLBACK_ISSUER = {
  tenantName: 'Omni-Channel Academy Platform',
  logoUrl: 'https://verify.omnichannel.com/assets/default-logo.png',
  verifiedDomain: 'verify.omnichannel.com',
};

@Injectable()
export class PublicCertificateVerificationService {
  private readonly logger = new Logger(PublicCertificateVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  async verifyPublicCertificate(args: PublicVerifyArgs): Promise<CertificateVerificationPayload> {
    const scannedAt = new Date().toISOString();
    const parsed = VerifyCertificateInputSchema.safeParse({
      certificateNo: args.certificateNo,
      hashSignature: args.hashSignature,
    });
    if (!parsed.success) {
      return { success: false, status: 'INVALID', message: 'รหัสใบรับรองไม่ถูกต้อง', data: null, scannedAt };
    }

    await this.checkRateLimit(args.ipAddress);

    const p = this.prisma as unknown as {
      courseCertificate: {
        findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
        update: (a: unknown) => Promise<unknown>;
      };
      certificateVerificationLog: { create: (a: unknown) => Promise<unknown> };
      tenant: { findUnique: (a: unknown) => Promise<{ id: string; name: string; logoUrl: string | null; domain: string | null } | null> };
    };

    const cert = await p.courseCertificate
      .findUnique({
        where: { certificateNo: parsed.data.certificateNo },
        include: { user: true, course: { include: { product: true } } },
      })
      .catch(() => null);
    if (!cert) {
      return {
        success: false,
        status: 'INVALID',
        message: 'ไม่พบข้อมูลใบรับรองนี้ในระบบ กรุณาตรวจสอบรหัสใหม่อีกครั้ง',
        data: null,
        scannedAt,
      };
    }

    const user = cert['user'] as { id: string; displayName: string; avatarUrl: string | null };
    const course = cert['course'] as {
      id: string;
      totalHours: number;
      product: { title: string; slug: string; sellerId: string; tenantId: string | null };
    };
    const hashOk = verifyPublicHash({
      certificateNo: String(cert['certificateNo']),
      userId: String(cert['userId']),
      courseId: String(cert['courseId']),
      displayName: user.displayName,
      storedSignature: String(cert['digitalSignatureHash']),
      providedHash: parsed.data.hashSignature,
    });
    if (!hashOk) {
      this.audit(String(cert['id']), args, false, 'INVALID');
      return {
        success: false,
        status: 'INVALID',
        message: 'การตรวจสอบล้มเหลว: ลายเซ็นดิจิทัลไม่ถูกต้องหรือเอกสารอาจถูกดัดแปลง',
        data: null,
        scannedAt,
      };
    }

    const status = fromLegacyStatus(String(cert['status'] ?? 'ISSUED'), Boolean(cert['isRevoked']));
    if (status === 'REVOKED') {
      this.audit(String(cert['id']), args, false, 'REVOKED');
      const reason = (cert['revokedReason'] as string | null) ?? 'ไม่ระบุ';
      return { success: false, status, message: `ใบรับรองนี้ถูกยกเลิกแล้ว สาเหตุ: ${reason}`, data: null, scannedAt };
    }
    if (status === 'EXPIRED') {
      this.audit(String(cert['id']), args, false, 'EXPIRED');
      return { success: false, status, message: 'ใบรับรองนี้หมดอายุแล้ว', data: null, scannedAt };
    }

    await p.courseCertificate
      .update({ where: { id: cert['id'] }, data: { viewCount: { increment: 1 } } })
      .catch(() => null);
    this.audit(String(cert['id']), args, true, 'VERIFIED');

    const tenantId = (cert['tenantId'] as string | null) ?? course.product.tenantId ?? course.product.sellerId;
    const tenant = await p.tenant.findUnique({ where: { id: tenantId } }).catch(() => null);
    const domain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN ?? 'https://cdn.local';
    const issuedAt = (cert['issuedAt'] as Date).toISOString();
    return {
      success: true,
      status: 'VERIFIED',
      message: 'ใบรับรองความสำเร็จนี้ได้รับการยืนยันความถูกต้อง 100%',
      scannedAt,
      data: {
        certificateNo: String(cert['certificateNo']),
        courseTitle: course.product.title,
        courseSlug: course.product.slug,
        totalHours: Number(course.totalHours ?? 0),
        issuedAt,
        pdfDownloadUrl: `${domain}/${String(cert['pdfStoragePathR2'])}`,
        student: {
          studentName: user.displayName,
          avatarUrl: user.avatarUrl,
          completionDate: issuedAt,
        },
        issuer: {
          tenantId,
          tenantName: tenant?.name ?? FALLBACK_ISSUER.tenantName,
          logoUrl: tenant?.logoUrl ?? FALLBACK_ISSUER.logoUrl,
          verifiedDomain: tenant?.domain ?? FALLBACK_ISSUER.verifiedDomain,
        },
      },
    };
  }

  private async checkRateLimit(ip: string): Promise<void> {
    const key = certVerifyRateKey(ip);
    const count = await this.redis.incrby(key, 1).catch(() => 0);
    if (count === 1) await this.redis.expire(key, 60).catch(() => undefined);
    if (count > CERT_VERIFY_RATE_PER_MIN) {
      throw new HttpException('Too many verification attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Fire-and-forget audit (Gate 7): never blocks the verify response. */
  private audit(certificateId: string, args: PublicVerifyArgs, isSuccess: boolean, resultStatus: string): void {
    const p = this.prisma as unknown as {
      certificateVerificationLog: { create: (a: unknown) => Promise<unknown> };
    };
    void p.certificateVerificationLog
      .create({ data: { certificateId, ipAddress: args.ipAddress, userAgent: args.userAgent, isSuccess, resultStatus } })
      .catch((err) => this.logger.error('Failed to save verification log', err));
  }
}
